/*
 * Anfang-, Ende- und Ketten-Modus von „Wortbombe“.
 *  anfang: Ein Wort, das mit … BEGINNT   – [Buchstabenfolge (klein), Stufe]
 *  ende:   Ein Wort, das auf … ENDET     – [Buchstabenfolge (klein), Stufe]
 *  kette:  Startwörter für die Wortkette (das nächste Wort beginnt mit dem letzten Buchstaben des vorigen)
 *
 * Stufe 1 = leicht, 2 = mittel, 3 = schwer – gezählt von scripts/wortbombe-stufen.js (siehe silben.js).
 */
(function (root) {
  'use strict';

  root.WBAnfangEnde = {
    anfang: [
      ['ver', 1], ['be', 1], ['ge', 1], ['ent', 2], ['zer', 3], ['er', 1], ['un', 1], ['ab', 1],
      ['an', 1], ['auf', 2], ['aus', 1], ['ein', 1], ['mit', 2], ['vor', 2], ['nach', 2], ['über', 2],
      ['unter', 2], ['um', 2], ['zu', 1], ['sch', 1], ['schl', 2], ['schm', 3], ['schn', 2], ['schr', 3],
      ['schw', 2], ['st', 1], ['sp', 1], ['str', 2], ['spr', 3], ['pf', 2], ['kl', 2], ['kr', 1],
      ['gr', 1], ['gl', 2], ['bl', 2], ['br', 1], ['fl', 2], ['fr', 1], ['dr', 2], ['tr', 1],
      ['pl', 2], ['pr', 1], ['kn', 3], ['zw', 2], ['qu', 2], ['ch', 2], ['ph', 3], ['th', 3],
      ['j', 1], ['v', 1], ['ei', 1], ['au', 1], ['eu', 3], ['ä', 3], ['ö', 3], ['ü', 2],
      ['auto', 3], ['haus', 3], ['hand', 2], ['super', 3],
    ],
    ende: [
      ['chen', 1], ['lein', 3], ['heit', 2], ['keit', 1], ['ung', 1], ['ig', 1], ['lich', 2], ['isch', 1],
      ['er', 1], ['el', 1], ['en', 1], ['ling', 3], ['schaft', 2], ['tum', 3], ['nis', 2], ['bar', 2],
      ['sam', 3], ['los', 3], ['haft', 2], ['ei', 2], ['ion', 1], ['tät', 2], ['ik', 2], ['ur', 2],
      ['ent', 2], ['ant', 3], ['ismus', 3], ['ist', 2], ['ade', 3], ['age', 2], ['ett', 3], ['ette', 3],
      ['enz', 3], ['anz', 3], ['ie', 1], ['ier', 2], ['ine', 2], ['eur', 3], ['iv', 3], ['al', 2],
      ['ell', 2], ['at', 2], ['and', 2], ['ort', 2], ['tz', 1], ['ck', 2], ['st', 1], ['ch', 1],
      ['pf', 2], ['o', 2], ['a', 1], ['i', 1], ['u', 2], ['y', 2], ['zeug', 3], ['werk', 3],
      ['mann', 2], ['haus', 2], ['tier', 3], ['ball', 3], ['zeit', 2], ['land', 3],
    ],
    kette: [
      'Haus', 'Sonne', 'Apfel', 'Tisch', 'Banane', 'Elefant', 'Regen', 'Katze', 'Lampe', 'Maus',
      'Nudel', 'Pirat', 'Tomate', 'Wolke', 'Ziege', 'Garten', 'Insel', 'Kino', 'Fenster', 'Schule',
      'Brot', 'Igel', 'Hund', 'Melone', 'Rakete', 'Zebra', 'Ofen', 'Uhr', 'Dose', 'Feder',
      'Kerze', 'Löwe', 'Nase', 'Pilz', 'Rose', 'Tiger', 'Vogel', 'Wurst', 'Zitrone', 'Biene',
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
