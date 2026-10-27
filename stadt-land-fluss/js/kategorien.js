/*
 * Kategorien für „Stadt, Land, Fluss“: Pakete zum Austauschen oder Mischen.
 *  - STANDARD: Stadt · Land · Fluss · Name · Tier · Beruf
 *  - Pakete: Klassisch, Popkultur, Essen, Lustig, Ab 18 (Standard aus)
 *  - Eigene Kategorien kommen aus den Einstellungen (im Browser gespeichert) als Paket „eigene“
 *  - LISTS: Kategorien mit Hilfsliste (js/listen/) – nur für das ✓ „bekannt“ bei der Abstimmung
 */
(function (root) {
  'use strict';

  const STANDARD = ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf'];

  const PACKS = [
    {
      id: 'klassisch',
      icon: '🏠',
      label: 'Klassisch',
      cats: ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf', 'Pflanze', 'Marke', 'Sportart', 'Körperteil', 'Musikinstrument', 'Kleidungsstück', 'Gegenstand im Haus', 'Hobby'],
    },
    {
      id: 'popkultur',
      icon: '🎬',
      label: 'Popkultur',
      cats: ['Film', 'Serie', 'Band/Musiker', 'Promi', 'Videospiel', 'Comicfigur', 'Song', 'Buch', 'Zeichentrickfigur', 'Superheld/Bösewicht', 'Märchenfigur', 'App/Website'],
    },
    {
      id: 'essen',
      icon: '🍔',
      label: 'Essen',
      cats: ['Gericht', 'Getränk', 'Obst/Gemüse', 'Süßigkeit', 'Gewürz', 'Cocktail', 'Käsesorte', 'Frühstück', 'Restaurant/Imbiss', 'Backware'],
    },
    {
      id: 'lustig',
      icon: '🤪',
      label: 'Lustig',
      cats: [
        'Grund zu spät zu kommen',
        'Ausrede',
        'Schimpfwort (harmlos)',
        'Etwas im Kühlschrank',
        'Was man nicht zur Oma sagt',
        'Etwas, das klebt',
        'Was man auf eine einsame Insel mitnimmt',
        'Schlechter Name für ein Haustier',
        'Etwas, das man nicht anfassen will',
        'Peinliches Geschenk',
        'Etwas, das nervt',
        'Etwas Rundes',
      ],
    },
    {
      id: 'ab18',
      icon: '🔥',
      label: 'Ab 18',
      adult: true,
      cats: ['Trinkspiel', 'Anmachspruch', 'Peinlicher Moment', 'Alkoholisches Getränk', 'Grund für einen Kater', 'Ausrede nach einer Party', 'Was man nach Mitternacht tut', 'Ort für ein erstes Date'],
    },
  ];

  const CUSTOM_PACK = { id: 'eigene', icon: '✏️', label: 'Eigene', cats: [] };

  const ICONS = {
    stadt: '🏙️',
    land: '🗺️',
    fluss: '🌊',
    name: '🙋',
    tier: '🐾',
    beruf: '👷',
    pflanze: '🌱',
    marke: '🏷️',
    sportart: '⚽',
    körperteil: '🦵',
    musikinstrument: '🎺',
    kleidungsstück: '👕',
    'gegenstand im haus': '🛋️',
    hobby: '🎨',
    film: '🎬',
    serie: '📺',
    'band/musiker': '🎸',
    promi: '⭐',
    videospiel: '🎮',
    comicfigur: '💥',
    song: '🎵',
    buch: '📚',
    zeichentrickfigur: '🐭',
    'superheld/bösewicht': '🦸',
    märchenfigur: '🧚',
    'app/website': '📱',
    gericht: '🍝',
    getränk: '🥤',
    'obst/gemüse': '🍎',
    süßigkeit: '🍬',
    gewürz: '🧂',
    cocktail: '🍹',
    käsesorte: '🧀',
    frühstück: '🥐',
    'restaurant/imbiss': '🍟',
    backware: '🥨',
    'grund zu spät zu kommen': '⏰',
    ausrede: '🙊',
    'schimpfwort (harmlos)': '🤬',
    'etwas im kühlschrank': '🧊',
    'was man nicht zur oma sagt': '👵',
    'etwas, das klebt': '🍯',
    'was man auf eine einsame insel mitnimmt': '🏝️',
    'schlechter name für ein haustier': '🐶',
    'etwas, das man nicht anfassen will': '🤢',
    'peinliches geschenk': '🎁',
    'etwas, das nervt': '😤',
    'etwas rundes': '⚪',
    trinkspiel: '🍻',
    anmachspruch: '😏',
    'peinlicher moment': '🙈',
    'alkoholisches getränk': '🍷',
    'grund für einen kater': '🤕',
    'ausrede nach einer party': '🥴',
    'was man nach mitternacht tut': '🌙',
    'ort für ein erstes date': '💘',
  };

  // Kategorie → Hilfsliste (SLFListen[id])
  const LISTS = { stadt: 'staedte', land: 'laender', fluss: 'fluesse', tier: 'tiere', name: 'namen' };

  const MAX_CAT = 40;

  function lower(cat) {
    return String(cat || '')
      .trim()
      .toLowerCase();
  }

  function icon(cat) {
    return ICONS[lower(cat)] || '✏️';
  }

  function listId(cat) {
    return LISTS[lower(cat)] || null;
  }

  /** Kategorie-Namen säubern (Steuerzeichen, spitze Klammern, Leerzeichen, Länge) */
  function clean(cat) {
    return String(cat == null ? '' : cat)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CAT);
  }

  /** Liste säubern: leere und doppelte (Groß/klein egal) raus */
  function cleanList(list, max) {
    const out = [];
    const seen = new Set();
    for (const c of Array.isArray(list) ? list : []) {
      const x = clean(c);
      const k = lower(x);
      if (!x || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
      if (max && out.length >= max) break;
    }
    return out;
  }

  function pack(id) {
    return PACKS.find((p) => p.id === id) || null;
  }

  /** Alle Kategorien der gewählten Pakete (eigene = custom) */
  function pool(packIds, custom) {
    const all = [];
    for (const id of packIds || []) {
      if (id === CUSTOM_PACK.id) all.push(...(custom || []));
      else if (pack(id)) all.push(...pack(id).cats);
    }
    return cleanList(all);
  }

  root.SLFKategorien = { STANDARD, PACKS, CUSTOM_PACK, ICONS, LISTS, MAX_CAT, icon, listId, clean, cleanList, pack, pool };
})(typeof window !== 'undefined' ? window : globalThis);
