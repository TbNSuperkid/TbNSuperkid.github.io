/*
 * Titel erkennen – gemeinsam für Schlecht erklärt (Filme) und die Musikspiele (Hit Story: Songs + Interpreten).
 * Erkennt, ob eine getippte Antwort stimmt, baut Lücken-Hinweise, macht Vorschläge beim Tippen und findet
 * verräterische Wörter in Beschreibungen.
 *
 * Gleich gilt:
 *  - Groß/klein, Umlaute (ä = ae), Akzente, Satzzeichen und Leerzeichen
 *  - Artikel am Anfang (der/die/das/the/a/an/ein/eine – auch mehrere: „Das A-Team“ = „A-Team“)
 *  - Zahlen als Ziffer, römisch oder Wort (2 = II = zwei), „Teil“/„Kapitel“/„Episode“ fallen weg
 *  - kleine Tippfehler: ab 6 Buchstaben 1 Fehler, dann 1 pro 6 Buchstaben (höchstens 3) – Zahlen müssen aber genau stimmen
 *
 * Antworten eines Films: Titel + weitere Antworten. Weitere Antworten mit ~ vorne sind Reihennamen
 * („~Harry Potter“) – die zählen nur, wenn nicht „streng“ gespielt wird.
 *
 * Songs (checkSong): Klammerzusätze fliegen raus („Sweet Dreams (Are Made of This)“ = „Sweet Dreams“, „(Radio Edit)“),
 * beim Interpreten zählt jede/r Beteiligte einzeln (feat., &, und, x, with …) und auch nur der hintere Teil des Namens
 * („Gaga“ = Lady Gaga, „Bowie“ = Queen & David Bowie, „Weeknd“ = The Weeknd).
 */
(function (root) {
  'use strict';

  const ARTICLES = new Set(['der', 'die', 'das', 'the', 'a', 'an', 'ein', 'eine']);
  const DROP = new Set(['teil', 'part', 'kapitel', 'chapter', 'episode']);
  const NUMBERS = {
    i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
    eins: '1', zwei: '2', drei: '3', vier: '4', fuenf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9', zehn: '10',
    one: '1', two: '2', three: '3', four: '4', five: '5',
  };
  // Wörter, die in Beschreibungen trotz Titel vorkommen dürfen (nur Wörter ab 4 Buchstaben sind relevant)
  const STOP = new Set([
    'eine', 'einer', 'eines', 'einem', 'einen', 'fuer', 'ueber', 'unter', 'nach', 'mein', 'dein', 'sein', 'seine', 'ihre',
    'alle', 'alles', 'kein', 'keine', 'nicht', 'nichts', 'auch', 'noch', 'wird', 'wenn', 'sich', 'dies', 'diese', 'oder',
    'zwei', 'drei', 'vier', 'fuenf', 'teil', 'kapitel', 'episode', 'part', 'chapter', 'film', 'movie',
    'from', 'with', 'into', 'your', 'what', 'when', 'this', 'that', 'there', 'they', 'them', 'have', 'about',
  ]);
  const ENDINGS = ['en', 'er', 'es', 'e', 'n', 's'];

  function lev(a, b) {
    return root.GameMatch.levenshtein(a, b);
  }

  /** Text → kleine Wörter ohne Umlaute/Akzente/Satzzeichen */
  function plainWords(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' und ')
      .replace(/([a-z])!([a-z])/g, '$1i$2') // P!nk = Pink
      .replace(/['’`´]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  /** Wörter eines Titels zum Vergleichen: Zahlen vereinheitlicht, Artikel am Anfang weg */
  function words(s) {
    const w = plainWords(s)
      .map((x) => NUMBERS[x] || x)
      .filter((x) => !DROP.has(x));
    while (w.length > 1 && ARTICLES.has(w[0])) w.shift();
    return w;
  }

  /** Vergleichsschlüssel: Wörter ohne Leerzeichen */
  function key(s) {
    return words(s).join('');
  }

  function digits(k) {
    return (k.match(/\d+/g) || []).join(',');
  }

  /** Erlaubte Tippfehler für eine Antwort dieser Länge */
  function tolerance(len) {
    return len < 6 ? 0 : Math.min(3, Math.max(1, Math.floor(len / 6)));
  }

  /**
   * Alle Antworten eines Films.
   * @param {{title: string, alts?: string[]}} film
   * @param {boolean} [strict] Reihennamen (~) weglassen
   * @returns {{text: string, key: string, series: boolean}[]}
   */
  function answers(film, strict) {
    const out = [{ text: film.title, key: key(film.title), series: false }];
    for (const a of film.alts || []) {
      const series = a.startsWith('~');
      if (series && strict) continue;
      const text = series ? a.slice(1).trim() : a;
      const k = key(text);
      if (k && !out.some((o) => o.key === k)) out.push({ text, key: k, series });
    }
    return out;
  }

  /**
   * Ist die getippte Antwort richtig?
   * @returns {'yes'|'close'|'no'} close = knapp daneben (ein Tippfehler zu viel)
   */
  function check(guess, film, opts) {
    const g = key(String(guess || '').slice(0, 120));
    if (g.length < 1) return 'no';
    let close = false;
    for (const a of answers(film, opts && opts.strict)) {
      if (g === a.key) return 'yes';
      if (digits(g) !== digits(a.key)) continue;
      const allowed = tolerance(a.key.length);
      const d = lev(g, a.key);
      if (d <= allowed) return 'yes';
      if (d === allowed + 1 && a.key.length >= 4) close = true;
    }
    return close ? 'close' : 'no';
  }

  /**
   * Lücken-Hinweis: Anfangsbuchstabe jedes Wortes, sonst Striche
   * („Der König der Löwen“ → „D__ K____ d__ L____“, „Spider-Man“ → „S_____-M__“)
   */
  function gaps(title) {
    let first = true;
    return Array.from(String(title).replace(/\s+/g, ' '))
      .map((ch) => {
        if (!/[\p{L}\p{N}]/u.test(ch)) {
          // Nach Leerzeichen, Bindestrich & Co. beginnt ein neues Wort – nach Apostroph nicht („Ralph reicht's“)
          if (!/['’]/.test(ch)) first = true;
          return ch;
        }
        if (first) {
          first = false;
          return ch;
        }
        return '_';
      })
      .join('');
  }

  /**
   * Vorschläge beim Tippen: Titel, bei denen ein Wort mit der Eingabe beginnt.
   * @param {string} query
   * @param {{title: string, alts?: string[]}[]} films
   * @param {number} [max]
   * @returns {string[]} Titel (Titel, die mit der Eingabe anfangen, zuerst)
   */
  function suggest(query, films, max) {
    const q = words(query);
    if (!q.length || q.join('').length < 2) return [];
    const needle = ' ' + q.join(' ');
    const starts = [];
    const inside = [];
    for (const f of films) {
      const texts = [f.title].concat((f.alts || []).map((a) => a.replace(/^~/, '')));
      let best = null;
      for (const t of texts) {
        // Artikel am Anfang zählt nicht: „kön“ passt am Anfang von „Der König der Löwen“
        const hay = ' ' + words(t).join(' ');
        const at = hay.indexOf(needle);
        if (at === 0) {
          best = 'start';
          break;
        }
        if (at > 0) best = 'inside';
      }
      if (best === 'start') starts.push(f.title);
      else if (best === 'inside') inside.push(f.title);
    }
    const sort = (list) => list.sort((a, b) => a.length - b.length || a.localeCompare(b, 'de'));
    return [...new Set(sort(starts).concat(sort(inside)))].slice(0, max || 6);
  }

  function stems(w) {
    const out = [w];
    for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 4 && !STOP.has(w.slice(0, -e.length))) out.push(w.slice(0, -e.length));
    return out;
  }

  /**
   * Verrät ein Text den Titel? Gibt die Titelwörter zurück, die (auch als Wortteil) im Text stecken.
   * Geprüft werden Wörter ab 4 Buchstaben aus Titel und allen weiteren Antworten.
   */
  function leaks(text, film) {
    const tw = plainWords(text);
    const found = [];
    const sources = [film.title].concat((film.alts || []).map((a) => a.replace(/^~/, '')));
    for (const src of sources) {
      for (const w of plainWords(src)) {
        if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w) || found.includes(w)) continue;
        if (stems(w).some((st) => tw.some((x) => x.includes(st)))) found.push(w);
      }
    }
    return found;
  }

  /* ---------- Songs und Interpreten ---------- */

  const FEAT = /\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x|&|und|and|\+)\s+|\s*,\s*/i;

  /** Titel ohne Klammerzusätze und „- Remastered …“ */
  function cleanTitle(title) {
    return String(title == null ? '' : title)
      .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Alle Beteiligten: „Queen & David Bowie“ → ['Queen', 'David Bowie'] */
  function artistParts(artist) {
    return String(artist == null ? '' : artist)
      .split(FEAT)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  /** Erlaubte Schreibweisen eines Interpreten als Schlüssel: ganzer Name, jede/r Beteiligte, hintere Namensteile ab 3 Buchstaben */
  function artistKeys(artist) {
    const out = new Set();
    const add = (k) => {
      if (k && k.length >= 3) out.add(k);
    };
    add(key(artist));
    for (const part of artistParts(artist)) {
      const w = words(part);
      add(w.join(''));
      // auch ohne Artikel-Abzug: „a-ha“ bleibt „aha“ (sonst nur „ha“)
      const raw = plainWords(part).join('');
      if (raw !== w.join('')) add(raw);
      for (let i = 1; i < w.length; i++) add(w.slice(i).join(''));
    }
    return [...out];
  }

  function fuzzy(guess, keys) {
    const text = String(guess || '').slice(0, 120);
    const g = key(text);
    if (!g) return 'no';
    // „A-ha“ getippt: auch ohne Artikel-Abzug vergleichen
    const raw = plainWords(text).join('');
    if (raw !== g && keys.includes(raw)) return 'yes';
    let close = false;
    for (const k of keys) {
      if (g === k) return 'yes';
      if (digits(g) !== digits(k)) continue;
      const allowed = tolerance(k.length);
      const d = lev(g, k);
      if (d <= allowed) return 'yes';
      if (d === allowed + 1 && k.length >= 4) close = true;
    }
    return close ? 'close' : 'no';
  }

  /** Stimmt der Interpret? 'yes' | 'close' | 'no' */
  function checkArtist(guess, artist) {
    return fuzzy(guess, artistKeys(artist));
  }

  /** Stimmt der Songtitel? Mit und ohne Klammerzusatz, plus weitere Antworten */
  function checkTitle(guess, song) {
    const clean = cleanTitle(song.title);
    const alts = [song.title].concat((song.alts || []).map(cleanTitle), song.alts || []).filter((a) => a && a !== clean);
    return check(guess, { title: clean, alts });
  }

  /** Titel und Interpret auf einmal: { title, artist, both } */
  function checkSong(titleGuess, artistGuess, song) {
    const title = checkTitle(titleGuess, song);
    const artist = checkArtist(artistGuess, song.artist);
    return { title, artist, both: title === 'yes' && artist === 'yes' };
  }

  const api = { words, key, answers, check, gaps, suggest, leaks, tolerance, plainWords, cleanTitle, artistParts, artistKeys, checkArtist, checkTitle, checkSong };
  root.GameTitles = api;
  root.SETitles = api; // alter Name aus Schlecht erklärt
})(typeof window !== 'undefined' ? window : globalThis);
