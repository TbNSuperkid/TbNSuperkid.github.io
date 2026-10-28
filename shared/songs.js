/*
 * Gemeinsame Song-Datenbank für die Musikspiele (Hit Story, später Guess the song …): einlesen, filtern, ziehen.
 *
 * Die Songs liegen in shared/songs/<kategorie>.js als Text, eine Zeile pro Song:
 *   Titel | Interpret | Jahr | Stufe 1–3 | weitere Antworten (; getrennt) | Titel-Übersetzung | Beschreibung
 * Die letzten drei Felder dürfen fehlen. Zeilen mit # werden ignoriert.
 *
 * Jahr = erste Veröffentlichung der bekannten Version (Single oder Album, je nachdem, was früher war) –
 * keine Remaster-, Best-of- oder Neuauflagen-Jahre. Bei Coverversionen zählt die bekannte Version.
 * Die Datenbank speichert keine Links, Ausschnitte werden erst beim Spielen gesucht.
 */
(function (root) {
  'use strict';

  const CURRENT_YEAR = new Date().getFullYear();
  const MIN_YEAR = 1950;
  const MAX_YEAR = Math.max(2026, CURRENT_YEAR);

  const CATEGORIES = [
    { id: 'klassiker-vor-1980', icon: '📻', label: 'Klassiker bis 1979', from: MIN_YEAR, to: 1979 },
    { id: 'charts-80er', icon: '📼', label: '80er-Charts', from: 1980, to: 1989 },
    { id: 'charts-90er', icon: '💿', label: '90er-Charts', from: 1990, to: 1999 },
    { id: 'charts-2000er', icon: '📀', label: '2000er-Charts', from: 2000, to: 2009 },
    { id: 'charts-2010er', icon: '📱', label: '2010er-Charts', from: 2010, to: 2019 },
    { id: 'charts-2020er', icon: '🎧', label: '2020er-Charts', from: 2020, to: MAX_YEAR },
    { id: 'deutsch', icon: '🇩🇪', label: 'Deutsch', from: MIN_YEAR, to: MAX_YEAR },
    { id: 'rock', icon: '🎸', label: 'Rock', from: MIN_YEAR, to: MAX_YEAR },
    { id: 'hiphop', icon: '🎤', label: 'Hip-Hop', from: MIN_YEAR, to: MAX_YEAR },
    { id: 'deutschrap', icon: '🔥', label: 'Deutschrap', from: MIN_YEAR, to: MAX_YEAR },
    { id: 'schlager-party', icon: '🎉', label: 'Schlager & Party', from: MIN_YEAR, to: MAX_YEAR },
    { id: 'film-serie', icon: '🎬', label: 'Film & Serie', from: MIN_YEAR, to: MAX_YEAR },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

  const DECADES = [];
  for (let d = Math.floor(MIN_YEAR / 10) * 10; d <= MAX_YEAR; d += 10) DECADES.push(d);

  const LEVELS = {
    easy: [1],
    mixed: [1, 2],
    all: [1, 2, 3],
    hard: [2, 3],
  };
  const LEVEL_IDS = Object.keys(LEVELS);

  let cache = null;

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  /** 1987 → 1980 */
  function decadeOf(year) {
    return Math.floor(year / 10) * 10;
  }

  /** 1980 → „80er“, 2010 → „2010er“ */
  function decadeLabel(decade) {
    return (decade < 2000 ? String(decade).slice(2) : String(decade)) + 'er';
  }

  function slug(text) {
    return (
      String(text || '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'x'
    );
  }

  /** Eindeutige ID aus Interpret und Titel (gleicher Song in zwei Kategorien = gleiche ID) */
  function songId(title, artist) {
    return slug(artist) + ':' + slug(title);
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @param {string} line
   * @param {string} cat Kategorie-ID
   */
  function parseLine(line, cat) {
    const parts = String(line || '')
      .split('|')
      .map((p) => p.trim());
    if (parts.length < 4 || parts.length > 7) return null;
    const [title, artist, yearText, levelText, altText = '', translation = '', text = ''] = parts;
    if (!title || !artist) return null;
    if (!/^\d{4}$/.test(yearText) || !/^[123]$/.test(levelText)) return null;
    const year = Number(yearText);
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    const alts = altText
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean);
    return {
      id: songId(title, artist),
      cat,
      title,
      artist,
      year,
      decade: decadeOf(year),
      level: Number(levelText),
      alts,
      translation,
      text,
    };
  }

  function parseList(text, cat) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseLine(line, cat));
  }

  /** Alle Songs je Kategorie (ungültige Zeilen werden übersprungen) */
  function all() {
    if (!cache) {
      const S = root.SONGS || {};
      cache = {};
      for (const id of CATEGORY_IDS) cache[id] = parseList(S[id], id).filter(Boolean);
    }
    return cache;
  }

  /** Alle Songs als eine Liste (doppelte Songs nur einmal) */
  function list() {
    const seen = new Set();
    const out = [];
    for (const id of CATEGORY_IDS) {
      for (const s of all()[id]) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        out.push(s);
      }
    }
    return out;
  }

  function byId(id) {
    return list().find((s) => s.id === id) || null;
  }

  /**
   * Songs, die zu Kategorien, Jahrzehnten und Schwierigkeit passen.
   * Leere oder fehlende Auswahl = alle. Passt nichts, wird zuerst die Schwierigkeit gelockert.
   * @param {{cats?: string[], decades?: number[], level?: string}} [opts]
   */
  function filter(opts) {
    const o = opts || {};
    const cats = (o.cats || []).filter((c) => CATEGORY_IDS.includes(c));
    const decades = (o.decades || []).map(Number).filter((d) => DECADES.includes(d));
    const levels = LEVELS[o.level] || LEVELS.all;
    const L = all();
    const seen = new Set();
    const base = [];
    for (const id of cats.length ? cats : CATEGORY_IDS) {
      for (const s of L[id]) {
        if (seen.has(s.id)) continue;
        if (decades.length && !decades.includes(s.decade)) continue;
        seen.add(s.id);
        base.push(s);
      }
    }
    const fit = base.filter((s) => levels.includes(s.level));
    return fit.length ? fit : base;
  }

  /** Songs nach Jahrzehnt gruppiert: { 1980: [...], 1990: [...] } */
  function byDecade(songs) {
    const out = {};
    for (const s of songs) (out[s.decade] = out[s.decade] || []).push(s);
    return out;
  }

  /**
   * Zieht einen Song, der noch nicht dran war. Mit spread (Standard) wird zuerst ein Jahrzehnt gelost und dann ein
   * Song daraus – sonst stapeln sich die Jahrzehnte mit den meisten Songs.
   * @param {object[]} songs Auswahl (z. B. aus filter())
   * @param {string[]} [used] IDs der Songs, die schon dran waren (wird ergänzt)
   * @param {{random?: Function, spread?: boolean}} [opts]
   * @returns {object|null} Kopie des Songs, null wenn alle schon dran waren
   */
  function draw(songs, used, opts) {
    const rnd = (opts && opts.random) || Math.random;
    const spread = !opts || opts.spread !== false;
    const usedSet = new Set(used || []);
    const free = (songs || []).filter((s) => !usedSet.has(s.id));
    if (!free.length) return null;
    let pool = free;
    if (spread) {
      const groups = byDecade(free);
      const keys = Object.keys(groups).sort();
      pool = groups[keys[Math.floor(rnd() * keys.length)]];
    }
    const s = pool[Math.floor(rnd() * pool.length)];
    if (Array.isArray(used)) used.push(s.id);
    return Object.assign({}, s, { alts: s.alts.slice() });
  }

  /** Anzahl Songs je Kategorie, Jahrzehnt und Stufe */
  function stats() {
    const L = all();
    const songs = list();
    const out = { total: songs.length, cats: {}, decades: {}, levels: { 1: 0, 2: 0, 3: 0 } };
    for (const c of CATEGORIES) out.cats[c.id] = L[c.id].length;
    for (const d of DECADES) out.decades[d] = 0;
    for (const s of songs) {
      out.decades[s.decade]++;
      out.levels[s.level]++;
    }
    return out;
  }

  /** Nur zum Testen: Datenbank neu einlesen */
  function reset() {
    cache = null;
  }

  root.Songs = {
    CATEGORIES,
    CATEGORY_IDS,
    DECADES,
    LEVELS,
    LEVEL_IDS,
    MIN_YEAR,
    MAX_YEAR,
    category,
    decadeOf,
    decadeLabel,
    songId,
    parseLine,
    all,
    list,
    byId,
    filter,
    byDecade,
    draw,
    stats,
    _parseList: parseList,
    _reset: reset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
