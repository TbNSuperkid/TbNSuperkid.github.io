'use strict';
/*
 * Titel und Interpreten aus einer Spotify-Playlist (oder einem Album) ziehen – als Vorlage für die Song-Datenbank.
 *
 *   node scripts/playlist.js <Spotify-Link | Exportify-CSV | Ordner mit CSVs> … [--details] [--out datei.txt]
 *
 * Mehrere Eingaben (oder ein Ordner) gehen auf einmal; ein Song, der in mehreren Playlists steht, kommt nur einmal.
 * --details hängt bei CSVs Jahr, Beliebtheit (0–100) und Genres als Kommentar an – Hilfe für Jahr, Stufe und
 * Kategorie. Achtung: Spotifys Jahr ist oft das einer Neuauflage oder Best-of, nicht das Original.
 *
 * Link: liest die öffentliche Einbett-Seite (open.spotify.com/embed/…), ohne Anmeldung und ohne Spotify-API.
 *       Spotify liefert dort höchstens 100 Songs – bei größeren Playlists warnt das Skript.
 * CSV:  für große oder private Playlists vorher bei https://exportify.net exportieren, die CSV-Datei hier angeben.
 *
 * Ausgabe: eine Zeile pro Song „Titel | Interpret“. Zusätze wie „- Remastered 2011“ oder „(feat. …)“ werden aus dem
 * Titel entfernt, Gäste stehen wie in der Datenbank als „A feat. B“ beim Interpreten. Songs, die schon in
 * shared/songs/ stehen, kommen als Kommentar (# schon drin …) dazu. Jahr und Stufe trägt man danach von Hand ein.
 * Nichts davon landet automatisch im Spiel – das Skript schreibt nur Text.
 */
const fs = require('fs');
const path = require('path');

const SHARED = path.join(__dirname, '..', 'shared');
// Kurz halten: Mit einer vollständigen Browser-Kennung liefert Spotify die App-Seite ohne Song-Anzahl
const UA = 'Mozilla/5.0';

// Zusätze, die nicht zum Songtitel gehören („Song - Remastered 2011“, „Song (feat. X)“, „Song [From „Film“]“)
const JUNK = /remaster|version|edit|mono|stereo|from|soundtrack|single|deluxe|bonus|\b(19|20)\d\d\b/i;
// Andere Aufnahme als das Original (oft von fremden Interpreten hochgeladen) – Titel wird bereinigt, Zeile aber markiert
const VARIANT = /sped|slowed|speed\b|nightcore|reverb|unplugged|\blive\b|acoustic|akustik|remix|\bmix\b|cover|instrumental|karaoke|bootleg|rework|\bflip\b/i;
const FEAT = /^(feat\.?|ft\.?|featuring|with|mit)\s+/i;

function loadSongs() {
  globalThis.window = globalThis;
  require(path.join(SHARED, 'songs.js'));
  const Songs = globalThis.Songs;
  for (const c of Songs.CATEGORY_IDS) require(path.join(SHARED, 'songs', c + '.js'));
  return Songs;
}

/**
 * Titel aufräumen. Gibt den Titel, den Text aus „(feat. …)“ und – bei Sped up, Remix, Live … – die entfernte
 * Bezeichnung zurück (`variant`), damit man den Original-Interpreten prüfen kann.
 */
function cleanTitle(raw) {
  let title = String(raw || '').trim();
  let feat = '';
  const variants = [];
  // Ein Zusatz: feat. → merken; Sped up/Remix/… → weg, aber merken; Remaster/Version/From … → weg; sonst bleibt er
  const take = (text) => {
    const t = text.trim();
    if (FEAT.test(t)) feat += ' ' + t.replace(FEAT, '');
    else if (VARIANT.test(t)) variants.unshift(t);
    else if (!JUNK.test(t)) return false;
    return true;
  };
  // Von hinten abbauen, bis nichts mehr passt („Song (feat. X) - Remix“ → erst „- Remix“, dann „(feat. X)“).
  // Klammern: „Kids (2 Finger an den Kopf)“ bleibt. Strich: der früheste „ - “, ab dem alles ein Zusatz ist
  // („I See Fire - From "The Hobbit - The Desolation …"“).
  for (;;) {
    const m = title.match(/\s*[([]([^()[\]]+)[)\]]\s*$/);
    if (m && take(m[1])) {
      title = title.slice(0, m.index).trim();
      continue;
    }
    const dashes = [...title.matchAll(/\s+[-–]\s+/g)];
    const d = dashes.find((x) => x.index > 0 && take(title.slice(x.index + x[0].length)));
    if (!d) break;
    title = title.slice(0, d.index).trim();
  }
  return { title, feat: feat.trim(), variant: variants.join(', ') };
}

/**
 * Interpreten wie bei Spotify mit „, “ getrennt. Bandnamen mit Komma („Earth, Wind & Fire“) zerfallen dabei –
 * deshalb wird beim Zusammensetzen wieder mit „, “ verbunden, nie mit etwas anderem.
 */
function splitArtists(text) {
  return String(text || '')
    .split(/\s*[,;]\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Interpreten-Zeile: wer im „(feat. …)“ des Titels steht, wird Gast → „A, B feat. C, D“.
 * @returns {{ artist: string, main: string, first: string }}
 */
function artistLine(artists, feat) {
  const inFeat = (a) => feat && feat.toLowerCase().includes(a.toLowerCase());
  let main = artists.filter((a) => !inFeat(a));
  let guests = artists.filter(inFeat);
  if (!main.length) (main = artists.slice(0, 1)), (guests = artists.slice(1));
  const head = main.join(', ');
  // Gäste aus dem Titel, die Spotify nicht als Interpret führt, trotzdem nennen
  const guestText = feat && !guests.length ? feat : guests.join(', ');
  return { artist: guestText ? `${head} feat. ${guestText}` : head, main: head, first: main[0] };
}

/* ---------- Spotify-Link ---------- */

function parseLink(arg) {
  const m = String(arg).match(/(playlist|album)[/:]([A-Za-z0-9]{22})/);
  if (m) return { type: m[1], id: m[2] };
  if (/^[A-Za-z0-9]{22}$/.test(arg)) return { type: 'playlist', id: arg };
  return null;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function fromSpotify({ type, id }) {
  const html = await get(`https://open.spotify.com/embed/${type}/${id}`);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Spotify hat keine Songliste geliefert (Seite geändert oder Playlist privat?)');
  const entity = JSON.parse(m[1]).props?.pageProps?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList)) throw new Error('Keine Songliste gefunden – ist die Playlist öffentlich?');
  // Gesamtzahl steht nur auf der normalen Seite – damit merken wir, ob die Einbett-Seite abgeschnitten hat
  let total = null;
  try {
    const page = await get(`https://open.spotify.com/${type}/${id}`);
    const c = page.match(/music:song_count" content="(\d+)"/);
    if (c) total = Number(c[1]);
  } catch {
    /* nur für die Warnung */
  }
  const tracks = entity.trackList
    .filter((t) => (t.entityType || 'track') === 'track')
    .map((t) => ({ title: t.title, artists: splitArtists(t.subtitle) }));
  return { name: entity.name || entity.title, tracks, total };
}

/* ---------- Exportify-CSV ---------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

function fromCsv(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ti = col(/^(track name|titel|title|name)$/);
  const ai = col(/artist/);
  if (ti < 0 || ai < 0) throw new Error(`Spalten „Track Name“ und „Artist Name(s)“ nicht gefunden (gefunden: ${head.join(', ')})`);
  // Nur als Hilfe für --details: Erscheinungsjahr (oft das einer Neuauflage!), Beliebtheit 0–100, Genres
  const yi = col(/^release date$/);
  const pi = col(/^popularity$/);
  const gi = col(/^genres$/);
  const tracks = rows.map((r) => {
    const a = r[ai] || '';
    // Exportify trennt mehrere Interpreten mit „;“ (ältere Versionen mit „,“)
    const artists = a.includes(';') ? a.split(';').map((s) => s.trim()).filter(Boolean) : splitArtists(a);
    const year = yi >= 0 ? (r[yi] || '').slice(0, 4) : '';
    return { title: r[ti], artists, year, popularity: pi >= 0 ? r[pi] : '', genres: gi >= 0 ? r[gi] : '' };
  });
  return { name: path.basename(file, path.extname(file)), tracks, total: tracks.length };
}

/* ---------- Ausgabe ---------- */

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Bekannte Songs zum Nachschlagen. Großzügig, damit nichts doppelt reinkommt:
 *  - Titel: auch ohne Klammerzusatz („Rocket Man (I Think It's Going to Be …)“ = „Rocket Man“)
 *  - Interpret: ohne „feat.“, jeder Einzelne aus „A & B“, ohne „The“, kleine Tippunterschiede („P!nk“ = „Pink“)
 * @returns {{ find(title: string, artists: string[]): string|null }} Kategorie des bekannten Songs oder null
 */
function knownSongs(Songs) {
  const slug = (x) => Songs.songId(x, 'a').split(':')[1]; // songId = slug(Interpret):slug(Titel)
  const titleKeys = (t) => {
    const c = cleanTitle(t).title;
    return [...new Set([slug(c), slug(c.replace(/\s*[([][^)\]]*[)\]]/g, ''))])].filter(Boolean);
  };
  const artistKeys = (names) =>
    [...new Set(names.flatMap((n) => {
      const main = n.split(/\s+(?:feat\.?|ft\.?)\s+/i)[0];
      return [main, ...main.split(/\s*(?:,|\s&\s|\sx\s|\sund\s)\s*/i)];
    }))]
      .map((n) => slug(n).replace(/^the-?/, ''))
      .filter(Boolean);
  const same = (a, b) =>
    a === b ||
    (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) ||
    (Math.min(a.length, b.length) > 3 && levenshtein(a, b) <= 1);
  const byTitle = new Map();
  for (const [cat, songs] of Object.entries(Songs.all())) {
    for (const s of songs) {
      const entry = { artists: artistKeys([s.artist]), cat };
      for (const k of titleKeys(s.title)) byTitle.set(k, [...(byTitle.get(k) || []), entry]);
    }
  }
  return {
    find(title, artists) {
      const mine = artistKeys(artists);
      for (const k of titleKeys(title)) {
        const hit = (byTitle.get(k) || []).find((e) => e.artists.some((a) => mine.some((m) => same(a, m))));
        if (hit) return hit.cat;
      }
      return null;
    },
  };
}

/**
 * Eine Liste auswerten. `seen` wird über mehrere Listen geteilt – ein Song, der schon in einer früheren
 * Playlist kam, wird nur gezählt (`repeated`), nicht nochmal ausgegeben.
 */
function build(list, Songs, known, seen, details) {
  const fresh = [];
  const old = [];
  let repeated = 0;
  for (const t of list.tracks) {
    if (!t.title || !t.artists.length) continue;
    const { title, feat, variant } = cleanTitle(t.title);
    const a = artistLine(t.artists, feat);
    const keys = [Songs.songId(title, a.main), Songs.songId(title, a.first)];
    if (keys.some((k) => seen.has(k))) {
      repeated++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    let line = `${title} | ${a.artist}`;
    const cat = known.find(title, t.artists);
    if (cat) {
      old.push(`# schon drin (${cat}): ${line}`);
      continue;
    }
    const hint = [
      variant ? `⚠️ war „${variant}“ – Original-Interpret prüfen` : '',
      ...(details ? [t.year, t.popularity !== '' && t.popularity != null ? `Beliebtheit ${t.popularity}` : '', t.genres] : []),
    ]
      .filter(Boolean)
      .join(' · ');
    if (hint) line = line.padEnd(60) + '  # ' + hint;
    fresh.push(line);
  }
  return { fresh, old, repeated };
}

/** Eingaben auflösen: Links bleiben, Ordner → alle .csv darin, Dateien bleiben */
function expand(inputs) {
  const out = [];
  for (const input of inputs) {
    if (parseLink(input)) out.push(input);
    else if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
      for (const f of fs.readdirSync(input).sort()) if (/\.csv$/i.test(f)) out.push(path.join(input, f));
    } else if (fs.existsSync(input)) out.push(input);
    else throw new Error('Weder ein Spotify-Link noch eine vorhandene Datei oder ein Ordner: ' + input);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const detIdx = args.indexOf('--details');
  const details = detIdx >= 0 && args.splice(detIdx, 1).length > 0;
  if (!args.length) {
    console.error('Aufruf: node scripts/playlist.js <Spotify-Link | CSV-Datei | Ordner> … [--details] [--out datei.txt]');
    process.exit(1);
  }
  const Songs = loadSongs();
  const known = knownSongs(Songs);
  const seen = new Set();
  const parts = [];
  const info = [];
  let sumFresh = 0;
  let sumOld = 0;
  let sumRepeated = 0;
  for (const input of expand(args)) {
    const link = parseLink(input);
    const list = link ? await fromSpotify(link) : fromCsv(input);
    const { fresh, old, repeated } = build(list, Songs, known, seen, details);
    sumFresh += fresh.length;
    sumOld += old.length;
    sumRepeated += repeated;
    const extra = repeated ? `, ${repeated} schon in einer Playlist weiter oben` : '';
    parts.push([`# ===== ${list.name} – ${fresh.length} neu, ${old.length} schon in der Datenbank${extra}`, ...fresh, ...old].join('\n'));
    info.push(`${list.name}: ${list.tracks.length} gelesen → ${fresh.length} neu, ${old.length} schon drin${extra}`);
    if (list.total && list.total > list.tracks.length) {
      info.push(`  ⚠️  Die Playlist hat ${list.total} Songs, Spotify hat nur ${list.tracks.length} herausgegeben.`);
      info.push('     Für alle Songs: bei https://exportify.net als CSV exportieren und die Datei hier angeben.');
    }
  }
  const text = parts.join('\n\n') + '\n';
  if (out) fs.writeFileSync(out, text);
  else process.stdout.write(text);
  if (parts.length > 1) info.push(`Zusammen: ${sumFresh} neu, ${sumOld} schon drin, ${sumRepeated} doppelt in den Playlists.`);
  if (out) info.push('Gespeichert in ' + out);
  console.error(info.join('\n'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fehler: ' + err.message);
    process.exit(1);
  });
}

module.exports = { cleanTitle, artistLine, splitArtists, parseLink, parseCsv, fromCsv, knownSongs };
