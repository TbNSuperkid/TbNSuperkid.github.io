/*
 * Hinweise prüfen für „Nur einer“ (auf Basis von shared/match.js):
 *  - ungültig gegen das Lösungswort: gleich, Plural/Tippfehler, enthält das Wort oder steckt darin,
 *    gleicher Wortstamm (Sonne → sonnig), Übersetzung aus einer kleinen Liste (Sonne → Sun), mehr als ein Wort
 *  - doppelt untereinander: gleiches Wort, Plural, Tippfehler, gleicher Wortstamm (heiß / heiße)
 *
 * Die Prüfung ist absichtlich eher streng – lieber einmal zu viel streichen, die Runde kann per Einspruch
 * „doch gültig“ machen. Synonyme (Auto / Wagen) sind nicht doppelt.
 */
(function (root) {
  'use strict';

  const M = root.GameMatch;
  const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/i;
  // Endungen für den Wortstamm (längste zuerst). Plural auf -n/-s erkennt schon match.js –
  // als Stamm-Endung wären sie zu grob (Hase / Hass).
  const SUFFIXES = ['lichen', 'liche', 'lich', 'chen', 'igen', 'iger', 'ige', 'ig', 'ern', 'en', 'er', 'es', 'e'];
  // Füllwörter in mehrteiligen Lösungen („Der König der Löwen“) – die zählen nicht als Teil des Wortes
  const FILLERS = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'von', 'mit', 'zu', 'im', 'in', 'am', 'ein', 'eine', 'the', 'of', 'and']);
  const MAX_CLUE = 30;

  // Kleine Übersetzungs-Liste (Englisch, ein paar Französisch/Italienisch/Spanisch) für häufige Lösungswörter.
  // Alles andere fängt die Runde per Einspruch.
  const TRANSLATIONS = {
    sonne: ['sun', 'soleil', 'sol', 'sole'],
    mond: ['moon', 'lune', 'luna'],
    stern: ['star', 'stella', 'estrella'],
    hund: ['dog', 'chien', 'cane', 'perro'],
    katze: ['cat', 'chat', 'gatto', 'gato'],
    haus: ['house', 'home', 'maison', 'casa'],
    auto: ['car', 'voiture', 'macchina', 'coche'],
    schule: ['school', 'ecole', 'scuola', 'escuela'],
    wasser: ['water', 'eau', 'acqua', 'agua'],
    feuer: ['fire', 'feu', 'fuoco', 'fuego'],
    baum: ['tree', 'arbre', 'albero', 'arbol'],
    meer: ['sea', 'ocean', 'mer', 'mare', 'mar'],
    strand: ['beach', 'plage', 'spiaggia', 'playa'],
    buch: ['book', 'livre', 'libro'],
    schnee: ['snow', 'neige', 'neve', 'nieve'],
    regen: ['rain', 'pluie', 'pioggia', 'lluvia'],
    winter: ['hiver', 'inverno', 'invierno'],
    sommer: ['summer', 'ete', 'estate', 'verano'],
    herz: ['heart', 'coeur', 'cuore', 'corazon'],
    liebe: ['love', 'amour', 'amore', 'amor'],
    blume: ['flower', 'fleur', 'fiore', 'flor'],
    apfel: ['apple', 'pomme', 'mela', 'manzana'],
    brot: ['bread', 'pain', 'pane', 'pan'],
    kaese: ['cheese', 'fromage', 'formaggio', 'queso'],
    milch: ['milk', 'lait', 'latte', 'leche'],
    bier: ['beer', 'biere', 'birra', 'cerveza'],
    wein: ['wine', 'vin', 'vino'],
    kaffee: ['coffee', 'cafe', 'caffe'],
    tee: ['tea', 'the', 'te'],
    pferd: ['horse', 'cheval', 'cavallo', 'caballo'],
    vogel: ['bird', 'oiseau', 'uccello', 'pajaro'],
    fisch: ['fish', 'poisson', 'pesce', 'pez'],
    maus: ['mouse', 'souris', 'topo', 'raton'],
    schwein: ['pig', 'cochon', 'maiale', 'cerdo'],
    kuh: ['cow', 'vache', 'mucca', 'vaca'],
    loewe: ['lion', 'leone', 'leon'],
    baer: ['bear', 'ours', 'orso', 'oso'],
    affe: ['monkey', 'ape', 'singe', 'scimmia', 'mono'],
    biene: ['bee', 'abeille', 'ape', 'abeja'],
    schlange: ['snake', 'serpent', 'serpente', 'serpiente'],
    zug: ['train', 'treno', 'tren'],
    flugzeug: ['plane', 'airplane', 'avion', 'aereo'],
    schiff: ['ship', 'boat', 'bateau', 'nave', 'barco'],
    fahrrad: ['bike', 'bicycle', 'velo', 'bicicletta', 'bicicleta'],
    stadt: ['city', 'town', 'ville', 'citta', 'ciudad'],
    berg: ['mountain', 'montagne', 'montagna', 'montana'],
    wald: ['forest', 'woods', 'foret', 'foresta', 'bosque'],
    insel: ['island', 'ile', 'isola', 'isla'],
    fluss: ['river', 'fleuve', 'riviere', 'fiume', 'rio'],
    himmel: ['sky', 'heaven', 'ciel', 'cielo'],
    nacht: ['night', 'nuit', 'notte', 'noche'],
    tag: ['day', 'jour', 'giorno', 'dia'],
    zeit: ['time', 'temps', 'tempo', 'tiempo'],
    uhr: ['clock', 'watch', 'horloge', 'orologio', 'reloj'],
    geld: ['money', 'cash', 'argent', 'soldi', 'dinero'],
    koenig: ['king', 'roi', 're', 'rey'],
    koenigin: ['queen', 'reine', 'regina', 'reina'],
    prinzessin: ['princess', 'princesse', 'principessa', 'princesa'],
    ritter: ['knight', 'chevalier', 'cavaliere', 'caballero'],
    hexe: ['witch', 'sorciere', 'strega', 'bruja'],
    drache: ['dragon', 'drago', 'dragon'],
    geist: ['ghost', 'spirit', 'fantome', 'fantasma'],
    weihnachten: ['christmas', 'xmas', 'noel', 'natale', 'navidad'],
    ostern: ['easter', 'paques', 'pasqua', 'pascua'],
    geburtstag: ['birthday', 'anniversaire', 'compleanno', 'cumpleanos'],
    hochzeit: ['wedding', 'mariage', 'matrimonio', 'boda'],
    party: ['fete', 'festa', 'fiesta'],
    musik: ['music', 'musique', 'musica'],
    film: ['movie', 'cinema', 'pelicula'],
    spiel: ['game', 'play', 'jeu', 'gioco', 'juego'],
    ball: ['balle', 'palla', 'pelota'],
    fussball: ['football', 'soccer', 'calcio', 'futbol'],
    arzt: ['doctor', 'medecin', 'medico'],
    lehrer: ['teacher', 'professeur', 'maestro', 'profesor'],
    polizei: ['police', 'polizia', 'policia', 'cop'],
    kind: ['child', 'kid', 'enfant', 'bambino', 'nino'],
    baby: ['bebe'],
    mutter: ['mother', 'mom', 'mum', 'mere', 'madre'],
    vater: ['father', 'dad', 'pere', 'padre'],
    freund: ['friend', 'ami', 'amico', 'amigo'],
    familie: ['family', 'famille', 'famiglia', 'familia'],
    essen: ['food', 'eat', 'manger', 'mangiare', 'comer'],
    kuchen: ['cake', 'gateau', 'torta', 'pastel'],
    schokolade: ['chocolate', 'chocolat', 'cioccolato'],
    eis: ['ice', 'icecream', 'glace', 'gelato', 'helado'],
    kartoffel: ['potato', 'patate', 'patata'],
    tomate: ['tomato', 'pomodoro'],
    ei: ['egg', 'oeuf', 'uovo', 'huevo'],
    salz: ['salt', 'sel', 'sale', 'sal'],
    zucker: ['sugar', 'sucre', 'zucchero', 'azucar'],
    tuer: ['door', 'porte', 'porta', 'puerta'],
    fenster: ['window', 'fenetre', 'finestra', 'ventana'],
    bett: ['bed', 'lit', 'letto', 'cama'],
    stuhl: ['chair', 'chaise', 'sedia', 'silla'],
    tisch: ['table', 'tavolo', 'mesa'],
    schluessel: ['key', 'cle', 'chiave', 'llave'],
    brille: ['glasses', 'lunettes', 'occhiali', 'gafas'],
    schuh: ['shoe', 'chaussure', 'scarpa', 'zapato'],
    hut: ['hat', 'chapeau', 'cappello', 'sombrero'],
    telefon: ['phone', 'telephone', 'telefono'],
    handy: ['phone', 'smartphone', 'cellphone', 'mobile'],
    computer: ['ordinateur', 'pc'],
    krieg: ['war', 'guerre', 'guerra'],
    frieden: ['peace', 'paix', 'pace', 'paz'],
    gold: ['oro', 'or'],
    licht: ['light', 'lumiere', 'luce', 'luz'],
    farbe: ['color', 'colour', 'couleur', 'colore'],
    rot: ['red', 'rouge', 'rosso', 'rojo'],
    blau: ['blue', 'bleu', 'blu', 'azul'],
    gruen: ['green', 'vert', 'verde'],
    schwarz: ['black', 'noir', 'nero', 'negro'],
    weiss: ['white', 'blanc', 'bianco', 'blanco'],
    hand: ['main', 'mano'],
    kopf: ['head', 'tete', 'testa', 'cabeza'],
    auge: ['eye', 'oeil', 'occhio', 'ojo'],
    zahn: ['tooth', 'teeth', 'dent', 'dente', 'diente'],
    traum: ['dream', 'reve', 'sogno', 'sueno'],
    angst: ['fear', 'peur', 'paura', 'miedo'],
    glueck: ['luck', 'happiness', 'chance', 'fortuna', 'suerte'],
    freiheit: ['freedom', 'liberty', 'liberte', 'liberta', 'libertad'],
    urlaub: ['vacation', 'holiday', 'vacances', 'vacanza', 'vacaciones'],
    reise: ['travel', 'trip', 'journey', 'voyage', 'viaggio', 'viaje'],
    kirche: ['church', 'eglise', 'chiesa', 'iglesia'],
    bruecke: ['bridge', 'pont', 'ponte', 'puente'],
    garten: ['garden', 'jardin', 'giardino'],
    kueche: ['kitchen', 'cuisine', 'cucina', 'cocina'],
    krankenhaus: ['hospital', 'hopital', 'ospedale'],
    kino: ['cinema', 'movies', 'cine'],
    flughafen: ['airport', 'aeroport', 'aeroporto', 'aeropuerto'],
    bahnhof: ['station', 'gare', 'stazione', 'estacion'],
    schiffbruch: ['shipwreck'],
    pirat: ['pirate', 'pirata'],
    zauberer: ['wizard', 'magician', 'mago'],
    roboter: ['robot', 'robo'],
    spinne: ['spider', 'araignee', 'ragno', 'arana'],
    hai: ['shark', 'requin', 'squalo', 'tiburon'],
    wolke: ['cloud', 'nuage', 'nuvola', 'nube'],
    wind: ['vent', 'vento', 'viento'],
    gewitter: ['storm', 'thunderstorm', 'orage', 'temporale', 'tormenta'],
    erde: ['earth', 'terre', 'terra', 'tierra'],
    welt: ['world', 'monde', 'mondo', 'mundo'],
    weltall: ['space', 'universe', 'espace', 'spazio', 'espacio'],
    krone: ['crown', 'couronne', 'corona'],
    schatz: ['treasure', 'tresor', 'tesoro'],
    schwert: ['sword', 'epee', 'spada', 'espada'],
    kerze: ['candle', 'bougie', 'candela', 'vela'],
    geschenk: ['gift', 'present', 'cadeau', 'regalo'],
    hose: ['pants', 'trousers', 'jeans', 'pantalon', 'pantaloni'],
    kleid: ['dress', 'robe', 'vestito', 'vestido'],
    koch: ['cook', 'chef', 'cuisinier', 'cuoco', 'cocinero'],
    baecker: ['baker', 'boulanger', 'panettiere', 'panadero'],
    bauer: ['farmer', 'fermier', 'contadino', 'granjero'],
    sport: ['deporte'],
    tanz: ['dance', 'danse', 'danza', 'baile'],
    tanzen: ['dance', 'dancing', 'danser', 'ballare', 'bailar'],
    schwimmen: ['swim', 'swimming', 'nager', 'nuotare', 'nadar'],
    lesen: ['read', 'reading', 'lire', 'leggere', 'leer'],
    kochen: ['cook', 'cooking', 'cuisiner', 'cucinare', 'cocinar'],
    schlafen: ['sleep', 'sleeping', 'dormir', 'dormire'],
  };

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CLUE);
  }

  /** Text ohne Artikel am Anfang */
  function stripArticle(text) {
    return clean(text).replace(ARTICLE, '');
  }

  /** Anzahl Wörter (ein Artikel am Anfang zählt nicht mit, Bindestrich-Wörter sind ein Wort) */
  function wordCount(text) {
    const s = stripArticle(text);
    return s ? s.split(' ').filter((w) => M.normalize(w)).length : 0;
  }

  /** Umlaut-Schreibweisen angleichen (Haus / Häuser, Fuß / Füße) */
  function flat(n) {
    return n.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  }

  /** Wortstamm: eine Endung abschneiden, wenn mindestens 3 Buchstaben bleiben */
  function stem(text) {
    const n = flat(M.normalize(text));
    for (const suf of SUFFIXES) {
      if (n.length - suf.length >= 3 && n.endsWith(suf)) return n.slice(0, -suf.length);
    }
    return n;
  }

  /** Gleicher Wortstamm? (nur bei Stämmen ab 3 Buchstaben, sonst wäre Ei = Eis) */
  function sameStem(a, b) {
    const x = stem(a);
    const y = stem(b);
    return x.length >= 3 && x === y;
  }

  /** Gelten zwei Hinweise als derselbe? (gleich, Plural, Tippfehler, Wortfamilie) */
  function alike(a, b) {
    const x = M.normalize(a);
    const y = M.normalize(b);
    if (!x || !y) return false;
    if (M.same(a, b) || sameStem(a, b)) return true;
    // Tippfehler schon ab 5 Buchstaben (match.js ist da vorsichtiger): Strnd = Strand
    return Math.min(x.length, y.length) >= 5 && x[0] === y[0] && Math.abs(x.length - y.length) <= 1 && M.levenshtein(x, y) <= 1;
  }

  /** Steckt part in whole? Ab 4 Buchstaben überall, mit 3 Buchstaben nur am Anfang oder Ende */
  function inside(part, whole) {
    if (part.length < 3 || whole.length <= part.length) return false;
    if (part.length >= 4) return whole.includes(part);
    return whole.startsWith(part) || whole.endsWith(part);
  }

  function translations(word) {
    const out = [];
    for (const part of stripArticle(word).split(/[\s-]+/)) {
      const list = TRANSLATIONS[M.normalize(part)];
      if (list) out.push(...list);
    }
    return out;
  }

  /**
   * Ist der Hinweis ungültig gegen das Lösungswort?
   * @returns {null|'empty'|'words'|'same'|'contains'|'inside'|'stem'|'translation'}
   */
  function invalid(clue, word) {
    const c = M.normalize(stripArticle(clue));
    if (!c) return 'empty';
    if (wordCount(clue) > 1) return 'words';
    const parts = stripArticle(word)
      .split(/[\s-]+/)
      .map((p) => M.normalize(p))
      .filter((p) => p.length >= 3 && !FILLERS.has(p));
    const whole = M.normalize(stripArticle(word));
    if (M.same(clue, word) || parts.some((p) => M.same(c, p))) return 'same';
    if ([whole, ...parts].some((p) => inside(p, c))) return 'contains';
    if (inside(c, whole)) return 'inside';
    if (sameStem(clue, word) || parts.some((p) => sameStem(c, p))) return 'stem';
    if (translations(word).some((t) => M.normalize(t) === c)) return 'translation';
    return null;
  }

  /**
   * Bildet Gruppen gleicher Hinweise.
   * @param {string[]} texts
   * @returns {number[][]} Gruppen von Indizes (größte zuerst, sonst in Reihenfolge); leere Hinweise in keiner Gruppe
   */
  function groups(texts) {
    const parent = texts.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) if (alike(texts[i], texts[j])) parent[find(j)] = find(i);
    }
    const map = new Map();
    texts.forEach((t, i) => {
      if (!M.normalize(t)) return;
      const r = find(i);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(i);
    });
    return [...map.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  }

  /**
   * Prüft alle Hinweise einer Karte.
   * @param {string[]} texts Hinweise (auch mehrere von derselben Person)
   * @param {string} word Lösungswort
   * @returns {{verdicts: ('ok'|'dupe'|'invalid')[], reasons: (string|null)[], groups: number[][]}}
   *   Ungültig geht vor doppelt. Doppelte werden alle gestrichen (auch das „erste“).
   */
  function check(texts, word) {
    const reasons = texts.map((t) => invalid(t, word));
    const g = groups(texts);
    const verdicts = texts.map((_, i) => (reasons[i] ? 'invalid' : 'ok'));
    for (const grp of g) {
      if (grp.length < 2) continue;
      for (const i of grp) if (verdicts[i] === 'ok') verdicts[i] = 'dupe';
    }
    return { verdicts, reasons, groups: g };
  }

  /** Antwort der ratenden Person richtig? („die Sonne“ = Sonne, Plural, kleine Tippfehler) */
  function correct(guess, word) {
    if (!M.normalize(guess)) return false;
    return M.same(stripArticle(guess), stripArticle(word)) || M.same(guess, word);
  }

  const REASONS = {
    empty: 'leer',
    words: 'mehr als ein Wort',
    same: 'ist das Wort selbst',
    contains: 'enthält das Wort',
    inside: 'steckt im Wort',
    stem: 'gleiche Wortfamilie',
    translation: 'Übersetzung',
    dupe: 'doppelt',
    manual: 'gestrichen',
  };

  root.NEClues = { MAX_CLUE, TRANSLATIONS, REASONS, clean, stripArticle, wordCount, stem, sameStem, alike, invalid, groups, check, correct };
})(typeof window !== 'undefined' ? window : globalThis);
