/*
 * Silben-Modus von „Wortbombe“: Ein Wort, das die Buchstabenfolge ENTHÄLT (egal wo).
 * Eintrag: [Buchstabenfolge (klein), Stufe] – Stufe 1 = leicht, 2 = mittel, 3 = schwer.
 *
 * Die Stufen sind nicht geschätzt, sondern gezählt: scripts/wortbombe-stufen.js zählt in einer freien
 * deutschen Wortliste, wie viele Wörter die Folge enthalten, und schreibt die Zahl hier hinein.
 * Neue Einträge also einfach mit irgendeiner Stufe ergänzen und danach das Skript laufen lassen.
 */
(function (root) {
  'use strict';

  root.WBSilben = [
    ['ung', 1], ['sch', 1], ['ei', 1], ['ie', 1], ['au', 1], ['eu', 1], ['äu', 2], ['er', 1],
    ['st', 1], ['tt', 1], ['ll', 1], ['mm', 1], ['nn', 1], ['ss', 1], ['ff', 2], ['pp', 2],
    ['rr', 2], ['ck', 1], ['tz', 1], ['pf', 1], ['xi', 3], ['qu', 2], ['zz', 3], ['gg', 3],
    ['bb', 3], ['dd', 3], ['kk', 3], ['aa', 2], ['ee', 2], ['oo', 3], ['ai', 2], ['ui', 3],
    ['ach', 1], ['ich', 1], ['och', 2], ['uch', 2], ['ein', 1], ['aus', 1], ['and', 1], ['ind', 2],
    ['und', 2], ['ast', 2], ['ost', 2], ['ist', 1], ['art', 2], ['ort', 2], ['ack', 2], ['eck', 2],
    ['ick', 2], ['ock', 2], ['uck', 2], ['all', 2], ['ell', 1], ['ill', 2], ['oll', 2], ['ull', 3],
    ['amm', 2], ['imm', 2], ['omm', 2], ['ang', 2], ['ing', 2], ['ong', 3], ['ank', 2], ['ink', 2],
    ['unk', 2], ['ant', 2], ['ott', 3], ['att', 2], ['ett', 2], ['itt', 2], ['eis', 1], ['ais', 3],
    ['ohr', 3], ['uhr', 3], ['ahn', 2], ['ehr', 2], ['ühl', 3], ['ück', 2], ['öl', 3], ['äs', 2],
    ['bl', 2], ['fl', 1], ['gl', 2], ['kl', 2], ['pl', 2], ['br', 1], ['dr', 2], ['fr', 1],
    ['gr', 1], ['kr', 1], ['pr', 1], ['tr', 1], ['schl', 2], ['schm', 2], ['schn', 2], ['schr', 2],
    ['schw', 2], ['spr', 2], ['str', 1], ['chs', 2], ['ps', 3], ['nk', 1], ['rm', 1], ['lm', 2],
    ['lf', 2], ['mpf', 2], ['tsch', 2], ['zw', 2], ['kn', 2], ['ph', 2], ['th', 2], ['sk', 2],
    ['ion', 1], ['eur', 3], ['ier', 1], ['ief', 2], ['ieg', 2], ['iel', 2], ['ahl', 2], ['ohl', 3],
    ['ahm', 3], ['ohn', 2], ['äh', 2], ['öh', 3], ['üh', 2], ['ex', 2], ['ox', 3], ['ax', 3],
    ['oi', 3], ['ey', 3], ['ma', 1], ['mo', 2], ['mu', 2], ['ka', 1], ['ko', 1], ['ku', 1],
    ['ba', 1], ['bo', 2], ['bu', 2], ['da', 2], ['do', 2], ['fa', 1], ['fi', 2], ['ga', 1],
    ['gu', 2], ['ha', 1], ['ho', 1], ['hu', 1], ['la', 1], ['li', 1], ['lo', 1], ['lu', 1],
    ['na', 1], ['no', 2], ['pa', 1], ['pi', 2], ['po', 2], ['ra', 1], ['ro', 1], ['ru', 1],
    ['ta', 1], ['to', 1], ['tu', 1], ['wa', 1], ['wi', 1], ['wo', 2], ['za', 2], ['zi', 1],
    ['auto', 3], ['haus', 2], ['ball', 3], ['wasser', 3], ['feuer', 3], ['baum', 3], ['tier', 2], ['land', 2],
    ['stadt', 3], ['bahn', 3], ['zeit', 2], ['licht', 3], ['kopf', 3], ['hand', 2], ['berg', 2], ['see', 3],
    ['schnee', 3], ['sonn', 3], ['mond', 3], ['stern', 3], ['hund', 3], ['katz', 3], ['maus', 3], ['brot', 3],
    ['milch', 3], ['tee', 3], ['buch', 3], ['spiel', 2], ['tisch', 2], ['schuh', 3], ['rad', 2], ['zug', 2],
    ['schiff', 3], ['kind', 3], ['mann', 2], ['frau', 3], ['herz', 3], ['gold', 3], ['geld', 3], ['glas', 3],
    ['holz', 3], ['stein', 3], ['blum', 3], ['wald', 3], ['feld', 3], ['nacht', 3], ['kalt', 3], ['warm', 3],
    ['klein', 3], ['rot', 3], ['grün', 3], ['gelb', 3], ['blau', 3], ['ober', 3], ['unter', 2], ['affe', 3],
  ];
})(typeof window !== 'undefined' ? window : globalThis);
