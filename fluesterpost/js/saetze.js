/*
 * Inhalte für Flüsterpost:
 *  - Startsätze für den 🎲-Vorschlag beim Schreiben (Familie / Ab 18 / eigene der Runde)
 *  - Startwörter für den Modus „Wort-Start“: die Zeichnen-Begriffe aus Guess the word! (leicht + mittel,
 *    ohne lange Redewendungen)
 * Ein Satz pro Zeile – gut zeichenbar, gern absurd.
 */
(function (root) {
  'use strict';

  const MAX_CUSTOM = 200;
  const MAX_TEXT = 90;

  const FAMILY = `
Ein Pinguin fährt Ski
Oma bügelt einen Fisch
Ein Hund liest Zeitung
Die Katze fährt Motorrad
Ein Elefant balanciert auf einem Ball
Ein Schneemann schmilzt in der Sauna
Ein Roboter gießt Blumen
Ein Dinosaurier putzt sich die Zähne
Eine Giraffe trägt einen Schal
Ein Pirat verliert sein Holzbein
Ein Hai mit Sonnenbrille
Ein Bär klaut Honig
Ein Ritter kämpft gegen eine Mücke
Ein Astronaut grillt auf dem Mond
Eine Schnecke gewinnt ein Wettrennen
Ein Gespenst hat Angst im Dunkeln
Ein Frosch küsst eine Prinzessin
Ein Zauberer zieht einen Hasen aus dem Hut
Eine Kuh springt über den Mond
Ein Tintenfisch spielt Schlagzeug
Opa tanzt auf dem Tisch
Ein Vampir beim Zahnarzt
Ein Huhn legt ein goldenes Ei
Ein Affe fährt Fahrrad
Eine Meerjungfrau beim Friseur
Ein Kaktus will kuscheln
Ein Drache pustet Kerzen aus
Ein Eisbär im Liegestuhl
Ein Koch jongliert mit Pfannkuchen
Ein Clown weint im Regen
Eine Ente im Schaumbad
Ein Feuerwehrmann rettet eine Katze vom Baum
Ein Schwein im Matsch
Ein Baby fährt Bagger
Eine Biene sticht einen Bären
Ein Wal macht eine Fontäne
Ein Igel umarmt einen Luftballon
Ein Känguru mit Rucksack
Ein Löwe beim Friseur
Ein Kind baut eine Sandburg
Die Sonne trägt eine Sonnenbrille
Ein Ufo entführt eine Kuh
Ein Mann rutscht auf einer Bananenschale aus
Eine Hexe fliegt auf einem Staubsauger
Ein Krokodil putzt sich die Zähne
Ein Bauer melkt eine Ziege
Ein Schaf zählt Menschen, um einzuschlafen
Eine Maus erschreckt einen Elefanten
Ein Hund jagt seinen Schwanz
Ein Fisch angelt einen Menschen
Ein Superheld bügelt sein Cape
Eine Oma fährt Skateboard
Ein Papagei telefoniert
Ein Eis schmilzt in der Sonne
Ein Rentier mit roter Nase
Ein Hamster im Laufrad
Ein Seehund balanciert einen Ball
Ein Lehrer schläft im Unterricht
Ein Bäcker backt eine riesige Brezel
Ein Turm aus Pfannkuchen
Ein Vogel baut ein Nest in einem Hut
Ein Zebra im Schlafanzug
Ein Gorilla trommelt auf seiner Brust
Ein Taucher findet eine Schatzkiste
Ein Wikinger rudert ein Boot
Eine Spinne strickt einen Pullover
Ein Pferd liest ein Buch
Ein Kamel in der Wüste hat Durst
Ein Schlumpf auf einem Pilz
Ein Weihnachtsmann im Kamin stecken geblieben
Ein Osterhase versteckt Eier
Ein Zahn wird gezogen
Ein Kind lässt einen Drachen steigen
Ein Wurm im Apfel
Ein Bär im Winterschlaf
Ein Mönch auf einem Einrad
Eine Kuh auf Rollschuhen
Ein Fußballer schießt ein Eigentor
Ein Torwart fängt einen Ball
Ein Schwimmer springt vom Zehnmeterbrett
Ein Hund im Planschbecken
Ein Gärtner mäht den Rasen
Ein Polizist regelt den Verkehr
Ein Kapitän im Sturm
Eine Prinzessin auf der Erbse
Ein Riese in einem kleinen Auto
Ein Zwerg auf einer Leiter
Ein Detektiv mit Lupe
Ein Hase isst eine Karotte
Ein Faultier hängt am Ast
Ein Flamingo steht auf einem Bein
Ein Pfau schlägt ein Rad
Eine Eule liest bei Kerzenlicht
Ein Fuchs stiehlt eine Gans
Ein Erdmännchen hält Wache
Ein Panda isst Bambus
Ein Nashorn im Porzellanladen
Ein Schmetterling schlüpft aus dem Kokon
Ein Marienkäfer auf einer Nase
Ein Regenbogen über einem Bauernhof
Ein Vulkan bricht aus
Ein Blitz schlägt in einen Baum ein
Ein Schneesturm im Sommer
Ein Iglu mit Kamin
Ein Leuchtturm in der Nacht
Ein Zug fährt durch einen Tunnel
Ein Heißluftballon über den Bergen
Ein Fallschirmspringer landet im Baum
Ein Tornado wirbelt eine Kuh herum
Eine Mumie wickelt sich aus
Ein Skelett spielt Xylophon
Ein Zombie im Supermarkt
Ein Ninja schleicht auf Zehenspitzen
Ein Cowboy reitet ein Schwein
Ein König verliert seine Krone
Ein Bagger hebt ein Loch aus
Ein Tannenbaum fällt um
Ein Schneeball trifft den Lehrer
Ein Lama spuckt
Ein Mann mit einem sehr langen Bart
Ein Kind springt in eine Pfütze
Eine Familie beim Picknick
Ein Hund hat die Hausaufgaben gefressen
Zwei Schnecken verlieben sich
Ein Ei fällt von der Mauer
Ein Wecker klingelt viel zu früh
`;

  const ADULT = `
Ein Kater nach der Party
Der Junggesellenabschied eskaliert
Jemand schläft auf der Party ein und wird bemalt
Ein Date beim Zahnarzt
Oma findet den Flachmann
Ein Bierfass rollt den Berg hinunter
Der Chef tanzt auf der Weihnachtsfeier
Jemand schreibt der Ex um drei Uhr nachts
Ein Kellner verschüttet Rotwein auf ein weißes Kleid
Ein Kopfsprung in ein leeres Becken
Die Polizei beendet die Hausparty
Ein Flirt im Fahrstuhl
Ein Mann verliert seine Hose beim Tanzen
Ein Pärchen streitet beim Möbelaufbau
Ein Tinder-Date mit einem Clown
Ein Hund frisst die Hochzeitstorte
Ein Bräutigam schläft am Altar ein
Ein Elefant in der Disco
Ein Einhorn kotzt einen Regenbogen
Jemand singt betrunken Karaoke
Der Nachbar spioniert durch die Hecke
Ein Vampir mit Knutschfleck
Ein Pirat im Whirlpool
Ein Nacktjogger im Schnee
Ein Saunagang mit dem Chef
Ein Bierbauch mit Sixpack-Tattoo
Ein Kater auf dem Kater
Jemand wacht neben einem Schwan auf
Ein Mönch im Stripclub
Der Weihnachtsmann ist betrunken
Ein Schwiegermonster beim Sonntagsessen
Ein Polterabend mit zu viel Porzellan
Jemand ruft aus Versehen die Mutter statt des Dates an
Ein Stripper im Hasenkostüm
Ein Spanner mit Fernglas
Ein Pärchen knutscht im Kino
Jemand kommt in Unterhose zur Arbeit
Ein Rentner auf einer Technoparty
Ein Sixpack aus Bier
Ein Bierpong-Tisch bricht zusammen
Jemand fällt in den Pool mit Handy
Ein Hund trägt einen BH
Eine Nonne fährt Achterbahn
Ein Liebesbrief landet beim falschen Empfänger
Der Wecker klingelt nach zwei Stunden Schlaf
Ein Mann schnarcht wie eine Kettensäge
Ein Bräutigam flieht vor der Hochzeit
Ein Gespenst sucht ein Date
Ein Kuss unter dem Mistelzweig
Ein Schwarm Mücken im Zelt
Ein Toilettengang im Festival-Dixi
Jemand steckt mit dem Kopf im Zaun fest
Ein Tanga am Kronleuchter
Ein Taxi voller Konfetti
Ein Dönerspieß um vier Uhr morgens
Ein Selfie mit einem Polizisten
Ein Mann im Ganzkörperanzug auf der Hochzeit
Ein Handy fällt ins Klo
Eine Katze erbricht auf den Laptop
Ein Bademantel beim Elternabend
Ein Wasserbett platzt
Ein Kissen voller Federn explodiert
Ein Kater mit Sonnenbrille und Aspirin
Jemand tanzt auf dem Tresen
Ein Flaschendrehen mit einem Hund
Der Brautstrauß trifft den Pfarrer
Ein Zombie beim Speed-Dating
Eine Schlägerei in der Hüpfburg
Ein Weinglas mit Strohhalm
Ein Bart voller Bierschaum
Ein Schnapsglas in Menschengröße
Ein Opa beim Moshpit
Ein Clown mit Kater
Ein Zahnarzt mit Zitterhänden
Ein Mann wird von einer Möwe ausgeraubt
Ein Pärchen im Partnerlook
Ein Junggeselle im Hühnerkostüm
`;

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  const DECKS = {
    family: { id: 'family', label: 'Familie', icon: '👨‍👩‍👧', list: lines(FAMILY) },
    adult: { id: 'adult', label: 'Ab 18', icon: '🔞', list: lines(ADULT) },
  };

  /** Eigene Sätze aus einem Textfeld (eine Zeile pro Satz), gesäubert und ohne Doppelte */
  function parseCustom(input) {
    const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split('\n');
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const s = String(item == null ? '' : item)
        .replace(/[\u0000-\u001f<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT);
      const key = s.toLowerCase();
      if (!s || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_CUSTOM) break;
    }
    return out;
  }

  /** Sätze für den 🎲-Vorschlag */
  function sentences(deck, custom) {
    if (deck === 'custom') return (custom || []).slice();
    return (DECKS[deck] || DECKS.family).list.slice();
  }

  let wordCache = null;
  /** Startwörter für „Wort-Start“ (Guess the word!, Zeichnen: leicht + mittel, höchstens 3 Wörter) */
  function words() {
    if (wordCache) return wordCache.slice();
    const src = ((root.ACTIVITY_WORDS || {}).zeichnen || {});
    const out = [];
    const seen = new Set();
    for (const level of ['leicht', 'mittel']) {
      for (const w of lines(src[level])) {
        const key = w.toLowerCase();
        if (w.split(/\s+/).length > 3 || seen.has(key)) continue;
        seen.add(key);
        out.push(w);
      }
    }
    wordCache = out;
    return out.slice();
  }

  root.FpContent = { DECKS, MAX_CUSTOM, MAX_TEXT, parseCustom, sentences, words };
})(typeof window !== 'undefined' ? window : globalThis);
