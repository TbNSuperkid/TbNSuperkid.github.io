/*
 * Zahlen für „Pi mal Daumen“: Eingaben verstehen („1.500“, „1,5 Mio“, „753 v. Chr.“) und schön anzeigen.
 * Deutsch zuerst: Punkt = Tausender, Komma = Dezimal. Ein einzelner Punkt mit nicht genau drei Ziffern
 * dahinter („1.5“) gilt als Dezimalpunkt.
 */
(function (root) {
  'use strict';

  const YEAR = 'Jahr';
  const MAX_ABS = 1e21;
  const MULTIPLIERS = [
    [/^(tsd|tausend|k)$/, 1e3],
    [/^(mio|mill|millionen?)$/, 1e6],
    [/^(mrd|mia|milliarden?)$/, 1e9],
    [/^(bio|billionen?)$/, 1e12],
    [/^(brd|billiarden?)$/, 1e15],
    [/^(trillionen?)$/, 1e18],
  ];
  const WORDS = [
    [1e18, 'Trillion', 'Trillionen'],
    [1e15, 'Billiarde', 'Billiarden'],
    [1e12, 'Billion', 'Billionen'],
    [1e9, 'Milliarde', 'Milliarden'],
    [1e6, 'Million', 'Millionen'],
  ];

  // Einzahl für häufige Einheiten („1 Person“ statt „1 Personen“)
  const SINGULAR = {
    Personen: 'Person',
    Menschen: 'Mensch',
    Jahre: 'Jahr',
    Tage: 'Tag',
    Wochen: 'Woche',
    Monate: 'Monat',
    Stunden: 'Stunde',
    Minuten: 'Minute',
    Sekunden: 'Sekunde',
    Länder: 'Land',
    Punkte: 'Punkt',
    Tore: 'Tor',
    Titel: 'Titel',
    Folgen: 'Folge',
    Filme: 'Film',
    Geschwister: 'Geschwister',
    Tiere: 'Tier',
    Bücher: 'Buch',
    Stück: 'Stück',
  };

  function isYear(unit) {
    return unit === YEAR;
  }

  /** Ziffernfolge mit Tausender-/Dezimaltrennern in eine Zahl umwandeln (ohne Vorzeichen) */
  function parseDigits(ns) {
    let s = ns.replace(/['’]/g, '');
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;
    if (dots && commas) {
      // Das Zeichen, das zuletzt kommt, ist der Dezimaltrenner
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (commas) {
      s = commas > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (dots > 1) {
      s = s.replace(/\./g, '');
    } else if (dots === 1 && /\.\d{3}$/.test(s) && !/^0\./.test(s)) {
      s = s.replace('.', '');
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Eingabe in eine Zahl umwandeln.
   * @returns {number|null} null, wenn keine Zahl erkannt wurde
   */
  function parse(input) {
    let s = String(input == null ? '' : input)
      .toLowerCase()
      .replace(/[−–]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return null;
    let sign = 1;
    if (/v\.? ?chr\.?$/.test(s)) {
      sign = -1;
      s = s.replace(/v\.? ?chr\.?$/, '').trim();
    } else if (/n\.? ?chr\.?$/.test(s)) {
      s = s.replace(/n\.? ?chr\.?$/, '').trim();
    }
    if (s.startsWith('-')) {
      sign = -sign;
      s = s.slice(1).trim();
    } else if (s.startsWith('+')) s = s.slice(1).trim();
    // Leerzeichen als Tausendertrenner („1 500 000“)
    s = s.replace(/(\d) (?=\d{3}(\D|$))/g, '$1');
    const m = s.match(/^([\d.,'’]+)\s*(.*)$/);
    if (!m) return null;
    let n = parseDigits(m[1]);
    if (n == null) return null;
    const rest = m[2].replace(/[.,;:!]+$/, '').trim();
    if (rest) {
      const word = rest.split(' ')[0].replace(/\.$/, '');
      const mult = MULTIPLIERS.find(([re]) => re.test(word));
      if (mult) n *= mult[1];
      else if (/^\d/.test(word)) return null; // „12 34“ o. Ä.
      // Alles andere (z. B. eine Einheit wie „Meter“) wird ignoriert
    }
    n *= sign;
    if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS) return null;
    // Rundungsrauschen von 1,1 * 1e6 o. Ä. entfernen
    return Math.round(n * 1e6) / 1e6;
  }

  function fmtNumber(n, maxDigits) {
    const abs = Math.abs(n);
    const digits = maxDigits != null ? maxDigits : abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
    return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(n);
  }

  /** Zahl formatieren (Jahreszahlen ohne Tausenderpunkt, negative Jahre als „v. Chr.“) */
  function format(n, unit) {
    if (n == null || !Number.isFinite(n)) return '–';
    if (isYear(unit)) {
      const y = Math.round(n);
      return y < 0 ? `${-y} v. Chr.` : String(y);
    }
    return fmtNumber(n);
  }

  /** Große Zahl in Worten: 1500000 → „1,5 Millionen“ (null unter einer Million) */
  function words(n) {
    if (n == null || !Number.isFinite(n)) return null;
    const abs = Math.abs(n);
    for (const [base, one, many] of WORDS) {
      if (abs >= base) {
        const v = n / base;
        const text = fmtNumber(v, Math.abs(v) >= 100 ? 0 : 2);
        return `${text} ${Math.abs(v) === 1 ? one : many}`;
      }
    }
    return null;
  }

  /** Zahl mit Einheit: „330 m“, „1989“, „12 %“ */
  function withUnit(n, unit) {
    const num = format(n, unit);
    if (!unit || isYear(unit) || num === '–') return num;
    return `${num} ${num === '1' && SINGULAR[unit] ? SINGULAR[unit] : unit}`;
  }

  /** Abstand zweier Zahlen, als Text mit Einheit („30 m“, „3 Jahre“) */
  function distance(d, unit) {
    if (isYear(unit)) return `${fmtNumber(Math.round(d), 0)} ${Math.round(d) === 1 ? 'Jahr' : 'Jahre'}`;
    return withUnit(d, unit);
  }

  root.PMDNumbers = { YEAR, isYear, parse, format, words, withUnit, distance };
})(typeof window !== 'undefined' ? window : globalThis);
