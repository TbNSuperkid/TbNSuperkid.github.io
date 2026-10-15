/*
 * Eingebauter Fragenkatalog von „Who knows more?“ – Format und Finalfragen.
 *
 * Die Kategorien liegen nach Gruppen in eigenen Dateien (wissen.js, pop.js, gaming.js, alltag.js,
 * schule.js, wort.js; 18+ in adult.js). Jede Kategorie hat 50 Fragen, je 10 pro Stufe:
 *   'Stufe|Frage|Antwort'   Stufe 1 = Feld 100 (leicht) … Stufe 5 = Feld 500 (echt schwer)
 * Pro Spiel kommt je Stufe eine Frage auf die Wand – bevorzugt eine, die in diesem Browser noch nicht dran war.
 * Mehrere richtige Antworten mit ' / ' trennen (die erste wird angezeigt, alle zählen beim Prüfen im Finale),
 * Klammern sind Erklärungen: 'Rot (Tor)'.
 * gruppe: wissen · pop · gaming · alltag · schule · wort  (pro Runde höchstens 2 aus derselben Gruppe)
 *
 * Finalfragen: 'Kategorie|Frage|Antwort' – etwas schwerer, es wird ja gezockt.
 */
(function (root) {
  'use strict';

  const K = (root.WKM_KATALOG = root.WKM_KATALOG || { kategorien: [], finale: [] });

  K.finale.push(
    'Geografie|Welcher Fluss fließt durch mehr Länder als jeder andere Fluss der Erde?|Donau',
    'Weltall|Welcher Planet unseres Sonnensystems „rollt“ mit einer Achsneigung von fast 98 Grad liegend um die Sonne?|Uranus',
    'Geschichte|Wie hieß der letzte Kaiser des Deutschen Kaiserreichs?|Wilhelm II. / Wilhelm der Zweite / Wilhelm',
    'Tiere|Welches Landsäugetier hat mit rund 22 Monaten die längste Tragzeit?|Elefant / Afrikanischer Elefant',
    'Medizin|Welches Antibiotikum entdeckte Alexander Fleming im Jahr 1928?|Penicillin',
    'Menschlicher Körper|Wie heißt der kleinste Knochen des Menschen?|Steigbügel / Stapes',
    'Film|Welcher Fantasyfilm gewann 2004 alle elf Oscars, für die er nominiert war?|Der Herr der Ringe: Die Rückkehr des Königs / Die Rückkehr des Königs / Herr der Ringe',
    'Musik|Welcher Komponist schrieb die Oper „Die Zauberflöte“?|Wolfgang Amadeus Mozart / Mozart',
    'Sprache|Wie nennt man Wörter, die gleich klingen, aber anders geschrieben werden – wie „Lerche“ und „Lärche“?|Homophone / Homofone',
    'Deutschland|In welcher Stadt wurde 1949 das Grundgesetz verkündet?|Bonn',
    'Kunst|Welcher spanische Maler schuf das Antikriegsbild „Guernica“?|Pablo Picasso / Picasso',
    'Sport|Wie viele Punkte hat das höchstmögliche reguläre Break im Snooker?|147',
    'Chemie|Welches Metall ist bei Zimmertemperatur flüssig?|Quecksilber',
    'Mathe|Wie nennt man eine Zahl wie 6 oder 28, die gleich der Summe ihrer echten Teiler ist?|Vollkommene Zahl / Perfekte Zahl',
    'Videospiele|Welches ist das meistverkaufte Videospiel aller Zeiten?|Minecraft',
    'Internet|Wofür steht „HTTP“ am Anfang von Internetadressen?|Hypertext Transfer Protocol',
    'Literatur|Wer schrieb den Roman „1984“?|George Orwell / Orwell',
    'Geografie|Welches Land hat – mit seinen Überseegebieten – die meisten Zeitzonen?|Frankreich',
    'Natur|Welches ist das größte Tier, das je auf der Erde gelebt hat?|Blauwal',
    'Weltall|Wie heißt die Galaxie, in der unser Sonnensystem liegt?|Milchstraße',
    'Geschichte|In welchem Jahr endete der Dreißigjährige Krieg?|1648',
    'Essen & Trinken|Von welchem Kontinent stammt die Kartoffel ursprünglich?|Südamerika / Amerika',
    'Technik|Wofür steht die Abkürzung „GPS“?|Global Positioning System',
    'Musik|Wie hieß die Band von Freddie Mercury?|Queen',
    'Tiere|Welche Säugetiere können als einzige aktiv fliegen?|Fledermäuse / Fledermaus / Flughunde',
    'Deutschland|Zu welchem Bundesland gehört die Hochseeinsel Helgoland?|Schleswig-Holstein',
    'Literatur|Wie heißt der Elfenkönig in Shakespeares „Ein Sommernachtstraum“?|Oberon',
    'Tiere|Welches Tier hat die größten Augen im ganzen Tierreich?|Koloss-Kalmar / Riesenkalmar / Kalmar',
    'Erfindungen|Nach welchem deutschen Physiker sind die 1895 entdeckten X-Strahlen benannt?|Wilhelm Conrad Röntgen / Röntgen',
    'Sport|In welcher Stadt fanden 1972 die Olympischen Sommerspiele statt?|München',
    'Chemie|Wer stellte 1869 das Periodensystem der Elemente auf?|Dmitri Mendelejew / Mendelejew / Lothar Meyer'
  );
})(typeof window !== 'undefined' ? window : globalThis);
