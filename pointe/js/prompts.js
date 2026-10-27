/*
 * Satzanfänge für „Pointe!“ einlesen, filtern, Namen einsetzen und ziehen – ohne Wiederholung im laufenden Spiel
 * und möglichst auch nicht aus früheren Spielen (der Browser merkt sich gezogene Satzanfänge in localStorage).
 *
 * Die Satzanfänge liegen in js/satzanfaenge/<kategorie>.js als Text, eine Zeile pro Satzanfang:
 *   Satzanfang mit ___ | Rettung 1; Rettung 2; Rettung 3
 * Finale: 1–3 Lücken, die Teile einer Rettung mit „ / “ getrennt.
 * Markierungen am Zeilenanfang: {fam:0} = nicht in der Familienrunde · {18} = nur mit „Ab 18“ (Finale)
 * Platzhalter: {Spieler} = Name aus der Runde, {Spielers} = derselbe Name im Genitiv („Annas“, „Klaus'“)
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'alltag', icon: '🏠', label: 'Alltag', text: 'Waschmaschine, Nachbarn, Familie' },
    { id: 'popkultur', icon: '🎬', label: 'Popkultur', text: 'Filme, Musik, Märchen' },
    { id: 'waswaere', icon: '🤔', label: 'Was wäre wenn', text: 'Wenn Katzen sprechen könnten …' },
    { id: 'namen', icon: '📛', label: 'Namen erfinden', text: 'Kreuzfahrtschiffe, Parfüms, Friseure' },
    { id: 'arbeit', icon: '🎓', label: 'Arbeit & Schule', text: 'Chef, Meetings, Hausaufgaben' },
    { id: 'adult', icon: '🔥', label: 'Ab 18', text: 'Dating, Party, Kater – derb', adult: true },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const DEFAULT_CATEGORIES = CATEGORIES.filter((c) => !c.adult).map((c) => c.id);
  const FINALE = 'finale';
  const BLANK = '___';
  const MAX_BLANKS = 3;
  const SEEN_KEY = 'pointe.seen.v1';
  const NAME_RE = /\{Spielers?\}/;

  let cache = null;

  /** Vergleichbare Form (klein, ohne Umlaute und Satzzeichen) */
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

  function countBlanks(text) {
    return String(text).split(BLANK).length - 1;
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @returns {{id, cat, text, blanks, rescues: string[][], family: boolean, adult: boolean, names: boolean}|null}
   */
  function parseLine(line, cat) {
    let rest = String(line || '').trim();
    let family = true;
    let adult = cat === 'adult';
    for (;;) {
      const m = rest.match(/^\{(fam:0|18)\}\s*/);
      if (!m) break;
      if (m[1] === 'fam:0') family = false;
      else adult = true;
      rest = rest.slice(m[0].length);
    }
    if (adult) family = false;
    const bar = rest.indexOf('|');
    if (bar < 0) return null;
    const text = rest.slice(0, bar).trim();
    const blanks = countBlanks(text);
    if (!text || blanks < 1 || blanks > (cat === FINALE ? MAX_BLANKS : 1)) return null;
    // Unterstriche müssen genau drei sein (sonst ist eine Lücke kaputt)
    if (/____/.test(text)) return null;
    const rescues = rest
      .slice(bar + 1)
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (blanks > 1 ? r.split(' / ').map((p) => p.trim()) : [r]))
      .filter((parts) => parts.length === blanks && parts.every(Boolean));
    if (rescues.length < 2) return null;
    return { id: cat + ':' + slug(text).slice(0, 60), cat, text, blanks, rescues, family, adult, names: NAME_RE.test(text) };
  }

  function parseList(text, cat) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseLine(line, cat));
  }

  /** Alle Satzanfänge je Kategorie (ungültige Zeilen werden übersprungen) */
  function all() {
    if (!cache) {
      const S = root.PT_SATZ || {};
      cache = {};
      for (const id of CATEGORY_IDS.concat(FINALE)) cache[id] = parseList(S[id], id).filter(Boolean);
    }
    return cache;
  }

  function list() {
    const L = all();
    return CATEGORY_IDS.concat(FINALE).flatMap((id) => L[id]);
  }

  function byId(id) {
    return list().find((p) => p.id === id) || null;
  }

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  /** Gültige Kategorien-Auswahl (mindestens eine, sonst die Standard-Auswahl) */
  function cleanCategories(cats) {
    const out = CATEGORY_IDS.filter((id) => Array.isArray(cats) && cats.includes(id));
    return out.length ? out : DEFAULT_CATEGORIES.slice();
  }

  /** Passt der Satzanfang zu den Einstellungen? */
  function allowed(p, settings) {
    const s = settings || {};
    if (s.family && !p.family) return false;
    if (p.names && !s.names) return false;
    if (p.cat === FINALE && p.adult && !cleanCategories(s.categories).includes('adult')) return false;
    return true;
  }

  /**
   * Vorrat für Duelle oder das Finale.
   * @param {object} settings { categories, family, names }
   * @param {'duel'|'final'} kind
   */
  function pool(settings, kind) {
    const L = all();
    const s = settings || {};
    if (kind === 'final') return L[FINALE].filter((p) => allowed(p, s));
    let cats = cleanCategories(s.categories);
    if (s.family) cats = cats.filter((c) => c !== 'adult');
    let out = cats.flatMap((c) => L[c]).filter((p) => allowed(p, s));
    // Familienrunde nur mit „Ab 18“ gewählt o. ä.: dann die Standard-Kategorien
    if (!out.length) out = DEFAULT_CATEGORIES.flatMap((c) => L[c]).filter((p) => allowed(p, s));
    return out;
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function loadSeen() {
    const ls = storage();
    if (!ls) return new Set();
    try {
      return new Set(JSON.parse(ls.getItem(SEEN_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveSeen(seen) {
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
      /* Speicher voll oder gesperrt – egal */
    }
  }

  /**
   * Zieht count Satzanfänge: zuerst solche, die weder in diesem Spiel noch in früheren Spielen dran waren.
   * @param {object[]} from Vorrat (pool)
   * @param {number} count
   * @param {string[]} usedInGame IDs, die in diesem Spiel schon dran waren (wird ergänzt)
   * @param {Function} [random]
   */
  function draw(from, count, usedInGame, random) {
    const rnd = random || Math.random;
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    const out = [];
    const take = (candidates) => {
      const a = candidates.filter((p) => !out.includes(p));
      while (out.length < count && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]);
    };
    take(from.filter((p) => !used.has(p.id) && !seen.has(p.id)));
    if (out.length < count) {
      // Alles schon einmal gesehen – gesehene dieser Auswahl zurückmischen
      for (const p of from) seen.delete(p.id);
      take(from.filter((p) => !used.has(p.id)));
    }
    if (out.length < count) take(from);
    for (const p of out) {
      seen.add(p.id);
      if (Array.isArray(usedInGame) && !usedInGame.includes(p.id)) usedInGame.push(p.id);
    }
    saveSeen(seen);
    return out;
  }

  /** Genitiv eines Namens: „Anna“ → „Annas“, „Klaus“ → „Klaus'“ */
  function genitive(name) {
    const n = String(name || '');
    return /[sßxz]$/i.test(n) ? n + '’' : n + 's';
  }

  /** {Spieler} / {Spielers} durch einen Namen ersetzen */
  function fillName(text, name) {
    return String(text)
      .replace(/\{Spielers\}/g, genitive(name))
      .replace(/\{Spieler\}/g, name);
  }

  /**
   * Satzanfang für ein Spiel fertig machen: Namen einsetzen (wenn nötig), alles kopieren.
   * @param {object} p Satzanfang aus dem Vorrat
   * @param {string[]} names mögliche Namen (z. B. alle außer den beiden im Duell)
   */
  function prepare(p, names, random) {
    const rnd = random || Math.random;
    const list = (names || []).filter(Boolean);
    const name = p.names && list.length ? list[Math.floor(rnd() * list.length)] : null;
    const fill = (t) => (name ? fillName(t, name) : t);
    return {
      id: p.id,
      cat: p.cat,
      text: fill(p.text),
      blanks: p.blanks,
      rescues: p.rescues.map((parts) => parts.map(fill)),
      name,
    };
  }

  /** Text zum Vorlesen: Lücke am Ende weglassen, in der Mitte „Dingsbums“ */
  function speakable(text) {
    return String(text || '')
      .replace(/[\s:,–-]*___[\s.?!…“”"]*$/u, '')
      .replace(/___/g, 'Dingsbums')
      .trim();
  }

  function stats() {
    const L = all();
    const out = { total: 0 };
    for (const id of CATEGORY_IDS.concat(FINALE)) {
      out[id] = L[id].length;
      out.total += L[id].length;
    }
    return out;
  }

  root.PointePrompts = {
    CATEGORIES,
    CATEGORY_IDS,
    DEFAULT_CATEGORIES,
    FINALE,
    BLANK,
    MAX_BLANKS,
    slug,
    countBlanks,
    parseLine,
    parseList,
    all,
    list,
    byId,
    category,
    cleanCategories,
    allowed,
    pool,
    draw,
    genitive,
    fillName,
    prepare,
    speakable,
    stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
