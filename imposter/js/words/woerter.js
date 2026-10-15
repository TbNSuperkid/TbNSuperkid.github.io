/*
 * Wörter für „Imposter“ – eine Zeile pro Wort: Kategorie|Wort|ähnliches Wort
 *  - Die Crew bekommt das Wort, bei „Undercover“ bekommt der Imposter das ähnliche Wort (und merkt es nicht).
 *  - Das ähnliche Wort soll nah dran sein (gleiche Hinweise passen oft), aber klar etwas anderes.
 *  - Kategorien: essen, orte, tiere, berufe, dinge, film, aktiv, adult (18+, nur wenn ausgewählt)
 *  - Berufe mit „:in“ – beim Raten zählt „Pilot“, „Pilotin“ und „Pilot:in“.
 * Zeilen mit # werden ignoriert. npm test prüft Format, Dopplungen und die Mindestanzahl je Kategorie.
 */
window.IM_WORDS = window.IM_WORDS || {};
window.IM_WORDS.woerter = `
# Essen & Trinken
essen|Pizza|Flammkuchen
essen|Kaffee|Tee
essen|Sushi|Ramen
essen|Döner|Burrito
essen|Burger|Hotdog
essen|Pommes|Kroketten
essen|Spaghetti|Lasagne
essen|Bier|Wein
essen|Schokolade|Gummibärchen
essen|Eis|Frozen Joghurt
essen|Pfannkuchen|Waffeln
essen|Croissant|Brezel
essen|Apfel|Birne
essen|Banane|Mango
essen|Erdbeere|Himbeere
essen|Kartoffel|Süßkartoffel
essen|Käse|Butter
essen|Milch|Joghurt
essen|Honig|Marmelade
essen|Popcorn|Chips
essen|Currywurst|Bratwurst
essen|Schnitzel|Frikadelle
essen|Suppe|Eintopf
essen|Salat|Bowl
essen|Tomate|Paprika
essen|Zwiebel|Knoblauch
essen|Spiegelei|Rührei
essen|Brot|Toast
essen|Käsekuchen|Tiramisu
essen|Cola|Limonade
essen|Orangensaft|Apfelschorle
essen|Smoothie|Milchshake
essen|Glühwein|Punsch
essen|Raclette|Fondue
essen|Steak|Schweinebraten
essen|Fischstäbchen|Chicken Nuggets
essen|Müsli|Cornflakes
essen|Nutella|Erdnussbutter
essen|Ketchup|Senf
essen|Mayonnaise|Aioli
essen|Gurke|Zucchini
essen|Karotte|Radieschen
essen|Wassermelone|Honigmelone
essen|Zitrone|Limette
essen|Kirsche|Pflaume
essen|Reis|Nudeln
essen|Taco|Wrap
essen|Lebkuchen|Spekulatius
essen|Donut|Muffin
essen|Pudding|Götterspeise
essen|Kaugummi|Bonbon
essen|Lakritz|Brausepulver
essen|Aperol Spritz|Hugo
essen|Cappuccino|Latte Macchiato
essen|Ananas|Kokosnuss
essen|Champignon|Pfifferling
essen|Spinat|Grünkohl
essen|Maultaschen|Ravioli
essen|Gulasch|Chili con Carne
essen|Sauerkraut|Rotkohl

# Orte
orte|Strand|Freibad
orte|Krankenhaus|Arztpraxis
orte|Kino|Theater
orte|Schule|Universität
orte|Bibliothek|Buchhandlung
orte|Flughafen|Bahnhof
orte|Supermarkt|Wochenmarkt
orte|Zoo|Aquarium
orte|Kirche|Kloster
orte|Gefängnis|Polizeiwache
orte|Fitnessstudio|Sporthalle
orte|Friseursalon|Nagelstudio
orte|Bäckerei|Konditorei
orte|Restaurant|Imbiss
orte|Bar|Biergarten
orte|Hotel|Jugendherberge
orte|Campingplatz|Zeltlager
orte|Freizeitpark|Jahrmarkt
orte|Museum|Galerie
orte|Fußballstadion|Eishalle
orte|Bauernhof|Reiterhof
orte|Wald|Park
orte|Skigebiet|Rodelbahn
orte|Wüste|Savanne
orte|Insel|Kreuzfahrtschiff
orte|Dschungel|Sumpf
orte|Nordpol|Grönland
orte|Raumstation|Mond
orte|Tankstelle|Autowerkstatt
orte|Parkhaus|Waschanlage
orte|Baumarkt|Möbelhaus
orte|Spielplatz|Kindergarten
orte|Hallenbad|Sauna
orte|Hafen|Leuchtturm
orte|Burg|Schloss
orte|Rathaus|Gericht
orte|Bank|Post
orte|Apotheke|Drogerie
orte|Disco|Konzert
orte|Bushaltestelle|U-Bahn-Station
orte|Autobahn|Landstraße
orte|Brücke|Tunnel
orte|Wasserfall|Stausee
orte|Vulkan|Geysir
orte|Höhle|Bergwerk
orte|Friedhof|Kapelle
orte|Zahnarztpraxis|Tierklinik
orte|Einkaufszentrum|Fußgängerzone
orte|Weihnachtsmarkt|Flohmarkt
orte|Paris|Rom
orte|New York|Los Angeles
orte|Venedig|Amsterdam
orte|Mallorca|Ibiza
orte|Berlin|Hamburg
orte|Pyramiden|Kolosseum
orte|Eiffelturm|Freiheitsstatue
orte|Las Vegas|Monaco
orte|Hollywood|Disneyland
orte|Waschsalon|Reinigung

# Tiere
tiere|Pinguin|Robbe
tiere|Hund|Wolf
tiere|Biene|Wespe
tiere|Katze|Luchs
tiere|Löwe|Tiger
tiere|Elefant|Nashorn
tiere|Giraffe|Zebra
tiere|Affe|Faultier
tiere|Delfin|Hai
tiere|Krokodil|Schildkröte
tiere|Schlange|Eidechse
tiere|Frosch|Molch
tiere|Schmetterling|Libelle
tiere|Spinne|Skorpion
tiere|Ameise|Marienkäfer
tiere|Maus|Hamster
tiere|Kaninchen|Meerschweinchen
tiere|Pferd|Esel
tiere|Kuh|Ziege
tiere|Schwein|Schaf
tiere|Huhn|Ente
tiere|Gans|Schwan
tiere|Adler|Geier
tiere|Eule|Fledermaus
tiere|Papagei|Wellensittich
tiere|Taube|Spatz
tiere|Storch|Flamingo
tiere|Kamel|Lama
tiere|Känguru|Koala
tiere|Panda|Eisbär
tiere|Fuchs|Dachs
tiere|Igel|Stachelschwein
tiere|Eichhörnchen|Murmeltier
tiere|Hirsch|Elch
tiere|Oktopus|Qualle
tiere|Krabbe|Hummer
tiere|Seestern|Seepferdchen
tiere|Goldfisch|Piranha
tiere|Lachs|Forelle
tiere|Mücke|Fliege
tiere|Schnecke|Regenwurm
tiere|Nilpferd|Seekuh
tiere|Gepard|Windhund
tiere|Hyäne|Schakal
tiere|Dinosaurier|Drache
tiere|Einhorn|Pegasus
tiere|Strauß|Truthahn
tiere|Pfau|Fasan
tiere|Hummel|Glühwürmchen
tiere|Waschbär|Stinktier
tiere|Maulwurf|Wühlmaus
tiere|Gorilla|Orang-Utan
tiere|Kakerlake|Käfer
tiere|Ratte|Frettchen
tiere|Wal|Walross
tiere|Biber|Otter
tiere|Rabe|Elster

# Berufe
berufe|Pilot:in|Lokführer:in
berufe|Ärzt:in|Tierärzt:in
berufe|Lehrer:in|Erzieher:in
berufe|Polizist:in|Detektiv:in
berufe|Feuerwehrmann|Rettungssanitäter:in
berufe|Köch:in|Bäcker:in
berufe|Friseur:in|Kosmetiker:in
berufe|Zahnärzt:in|Optiker:in
berufe|Astronaut:in|Tiefseetaucher:in
berufe|Landwirt:in|Gärtner:in
berufe|Tischler:in|Maurer:in
berufe|Elektriker:in|Klempner:in
berufe|Mechaniker:in|Tankwart:in
berufe|Busfahrer:in|Taxifahrer:in
berufe|Briefträger:in|Kurierfahrer:in
berufe|Kassierer:in|Verkäufer:in
berufe|Kellner:in|Barkeeper:in
berufe|Anwält:in|Richter:in
berufe|Reporter:in|Moderator:in
berufe|Schauspieler:in|Sänger:in
berufe|DJ|Rapper:in
berufe|Fotograf:in|Maler:in
berufe|Architekt:in|Bauingenieur:in
berufe|Programmierer:in|Hacker:in
berufe|Influencer:in|YouTuber:in
berufe|Fußballprofi|Schiedsrichter:in
berufe|Personal Trainer:in|Physiotherapeut:in
berufe|Krankenpfleger:in|Hebamme
berufe|Apotheker:in|Chemiker:in
berufe|Archäolog:in|Historiker:in
berufe|Bürgermeister:in|Bundeskanzler:in
berufe|König:in|Kaiser:in
berufe|Pirat:in|Wikinger:in
berufe|Zauberkünstler:in|Clown
berufe|Banker:in|Steuerberater:in
berufe|Ritter|Soldat:in
berufe|Bademeister:in|Skilehrer:in
berufe|Tierpfleger:in|Hundetrainer:in
berufe|Förster:in|Jäger:in
berufe|Fischer:in|Kapitän:in
berufe|Flugbegleiter:in|Zugbegleiter:in
berufe|Schornsteinfeger:in|Dachdecker:in
berufe|Bestatter:in|Pfarrer:in
berufe|Psycholog:in|Seelsorger:in
berufe|Tätowierer:in|Piercer:in
berufe|Metzger:in|Fischhändler:in
berufe|Hausmeister:in|Handwerker:in
berufe|Model|Tänzer:in
berufe|Erfinder:in|Wissenschaftler:in
berufe|Professor:in|Forscher:in
berufe|Imker:in|Schäfer:in
berufe|Sekretär:in|Rezeptionist:in
berufe|Streamer:in|Podcaster:in
berufe|Comedian|Kabarettist:in
berufe|Dolmetscher:in|Übersetzer:in
berufe|Spion:in|Geheimagent:in
berufe|Müllwerker:in|Straßenkehrer:in

# Dinge
dinge|Regenschirm|Sonnenschirm
dinge|Zahnbürste|Kamm
dinge|Handy|Tablet
dinge|Laptop|Schreibmaschine
dinge|Fernseher|Beamer
dinge|Kühlschrank|Backofen
dinge|Waschmaschine|Spülmaschine
dinge|Staubsauger|Besen
dinge|Fahrrad|E-Scooter
dinge|Auto|Motorrad
dinge|Flugzeug|Hubschrauber
dinge|Zug|Straßenbahn
dinge|Schiff|U-Boot
dinge|Uhr|Wecker
dinge|Brille|Lupe
dinge|Schlüssel|Chipkarte
dinge|Kerze|Taschenlampe
dinge|Bett|Sofa
dinge|Stuhl|Hocker
dinge|Spiegel|Fenster
dinge|Tür|Tor
dinge|Buch|Zeitung
dinge|Stift|Pinsel
dinge|Schere|Messer
dinge|Gabel|Stäbchen
dinge|Topf|Pfanne
dinge|Teller|Schüssel
dinge|Tasse|Weinglas
dinge|Koffer|Rucksack
dinge|Handtasche|Geldbeutel
dinge|Kopfhörer|Lautsprecher
dinge|Mikrofon|Megafon
dinge|Kamera|Fernglas
dinge|Ball|Luftballon
dinge|Würfel|Spielkarten
dinge|Puppe|Teddybär
dinge|Gitarre|Geige
dinge|Klavier|Schlagzeug
dinge|Trompete|Saxofon
dinge|Hammer|Schraubenzieher
dinge|Leiter|Treppe
dinge|Seil|Kette
dinge|Zelt|Schlafsack
dinge|Kissen|Decke
dinge|Handschuh|Socke
dinge|Schal|Krawatte
dinge|Mütze|Helm
dinge|Turnschuh|Flip-Flops
dinge|Ring|Halskette
dinge|Krone|Zepter
dinge|Schwert|Axt
dinge|Pistole|Pfeil und Bogen
dinge|Rakete|Satellit
dinge|Roboter|Drohne
dinge|Ampel|Verkehrsschild
dinge|Briefkasten|Mülltonne
dinge|Badewanne|Dusche
dinge|Toilette|Waschbecken
dinge|Föhn|Glätteisen
dinge|Zahnpasta|Duschgel
dinge|Feuerzeug|Streichholz
dinge|Geldschein|Münze
dinge|Weihnachtsbaum|Adventskranz
dinge|Schneemann|Sandburg
dinge|Trampolin|Hüpfburg
dinge|Schaukel|Rutsche
dinge|Kinderwagen|Einkaufswagen

# Film & Serien
film|Harry Potter|Herr der Ringe
film|Shrek|Ice Age
film|Star Wars|Star Trek
film|Titanic|Avatar
film|Der König der Löwen|Das Dschungelbuch
film|Die Eiskönigin|Rapunzel
film|Findet Nemo|Arielle die Meerjungfrau
film|Toy Story|Cars
film|Minions|Die Schlümpfe
film|Die Simpsons|Family Guy
film|SpongeBob|Biene Maja
film|Batman|Spider-Man
film|Superman|Captain America
film|Avengers|X-Men
film|James Bond|Mission Impossible
film|Jurassic Park|King Kong
film|Indiana Jones|Die Mumie
film|Der Hobbit|Narnia
film|Game of Thrones|Vikings
film|Stranger Things|Dark
film|Breaking Bad|Narcos
film|Haus des Geldes|Ocean's Eleven
film|Squid Game|Die Tribute von Panem
film|Friends|How I Met Your Mother
film|The Big Bang Theory|The Office
film|Sherlock|Tatort
film|Fluch der Karibik|Peter Pan
film|Zurück in die Zukunft|Doctor Who
film|Matrix|Inception
film|Rocky|Karate Kid
film|Fast & Furious|Need for Speed
film|Mamma Mia|Grease
film|Ghostbusters|Men in Black
film|Kevin allein zu Haus|Der Grinch
film|Pippi Langstrumpf|Heidi
film|Benjamin Blümchen|Bibi Blocksberg
film|Dschungelcamp|Big Brother
film|Germany's Next Topmodel|The Voice
film|Die Sendung mit der Maus|Löwenzahn
film|Tom und Jerry|Garfield
film|Asterix|Lucky Luke
film|Mickey Mouse|Donald Duck
film|Barbie|Oppenheimer
film|Darth Vader|Voldemort
film|Gandalf|Dumbledore
film|Jack Sparrow|Captain Hook
film|Super Mario|Sonic
film|Pokémon|Digimon
film|Tarzan|Robinson Crusoe
film|Aladdin|Mulan
film|Schneewittchen|Dornröschen
film|Aschenputtel|Rotkäppchen
film|Alice im Wunderland|Der Zauberer von Oz
film|Dracula|Frankenstein
film|Ninja Turtles|Power Rangers
film|Paw Patrol|Feuerwehrmann Sam
film|Wer wird Millionär|Quizduell

# Aktivitäten
aktiv|Skifahren|Snowboarden
aktiv|Joggen|Radfahren
aktiv|Schwimmen|Tauchen
aktiv|Tanzen|Singen
aktiv|Kochen|Backen
aktiv|Lesen|Schreiben
aktiv|Grillen|Picknick
aktiv|Zelten|Wandern
aktiv|Angeln|Jagen
aktiv|Fußball|Handball
aktiv|Tennis|Badminton
aktiv|Basketball|Volleyball
aktiv|Golf|Minigolf
aktiv|Bowling|Kegeln
aktiv|Billard|Darts
aktiv|Boxen|Ringen
aktiv|Yoga|Pilates
aktiv|Reiten|Rodeo
aktiv|Surfen|Segeln
aktiv|Klettern|Bouldern
aktiv|Schlittschuhlaufen|Rollschuhfahren
aktiv|Fallschirmspringen|Bungee-Jumping
aktiv|Karaoke|Poetry Slam
aktiv|Shoppen|Online-Shopping
aktiv|Videospiele|Brettspiele
aktiv|Schach|Dame
aktiv|Puzzeln|Sudoku
aktiv|Malen|Basteln
aktiv|Gärtnern|Rasenmähen
aktiv|Putzen|Aufräumen
aktiv|Bügeln|Wäsche waschen
aktiv|Abwaschen|Abtrocknen
aktiv|Duschen|Baden
aktiv|Schlafen|Meditieren
aktiv|Zähneputzen|Haare kämmen
aktiv|Schminken|Rasieren
aktiv|Fotografieren|Filmen
aktiv|Kreuzfahrt|Roadtrip
aktiv|Autofahren|Motorradfahren
aktiv|Fliegen|Zugfahren
aktiv|Umziehen|Renovieren
aktiv|Heiraten|Verloben
aktiv|Kindergeburtstag|Junggesellenabschied
aktiv|Poker|Roulette
aktiv|Lotto|Rubbellos
aktiv|Verstecken|Fangen
aktiv|Schneeballschlacht|Wasserschlacht
aktiv|Hausaufgaben|Lernen
aktiv|Stricken|Häkeln
aktiv|Jonglieren|Zaubern
aktiv|Escape Room|Lasertag
aktiv|Paintball|Bogenschießen
aktiv|Achterbahn|Riesenrad
aktiv|Skateboarden|Inlineskaten
aktiv|Massage|Maniküre
aktiv|Rudern|Kajakfahren
aktiv|Judo|Karate
aktiv|Marathon|Triathlon
aktiv|Tischtennis|Tischfußball

# 18+ (nur wenn die Kategorie ausgewählt ist)
adult|Kondom|Pille
adult|One-Night-Stand|Affäre
adult|Striptease|Lapdance
adult|Polterabend|Junggesellinnenabschied
adult|Kater|Filmriss
adult|Bierpong|Flunkyball
adult|Tequila|Wodka
adult|Jägermeister|Ouzo
adult|Schnaps|Likör
adult|Beschwipst|Sturzbetrunken
adult|Knutschfleck|Zungenkuss
adult|Erstes Date|Blind Date
adult|Tinder|Speed-Dating
adult|Handschellen|Augenbinde
adult|Dessous|Badeanzug
adult|Whirlpool|Wasserbett
adult|Sexshop|Erotikmesse
adult|Sugar Daddy|Toyboy
adult|Fremdgehen|Schlussmachen
adult|Walk of Shame|Katerfrühstück
adult|Ex|Schwarm
adult|Flirten|Zwinkern
adult|Dreier|Partnertausch
adult|Vorspiel|Kuscheln
adult|Nacktbaden|Flitzen
adult|Playboy|OnlyFans
adult|Schwangerschaftstest|Pille danach
adult|Domina|Stripperin
adult|Swingerclub|Darkroom
adult|Sexting|Liebesbrief
adult|Kamasutra|Fifty Shades of Grey
adult|Vibrator|Liebeskugeln
adult|Komasaufen|Absturz
adult|Kotzen|Schluckauf
adult|Kiffen|Shisha
adult|Ballermann|Oktoberfest
adult|Schaumparty|Wet-T-Shirt-Contest
adult|Vorglühen|Afterparty
adult|Strip-Poker|Flaschendrehen
adult|Wahrheit oder Pflicht|Ich hab noch nie
adult|Quickie|Morgensex
adult|Sex on the Beach|Piña Colada
adult|Hochzeitsnacht|Flitterwochen
adult|Liebeskummer|Eifersucht
adult|Fetisch|Rollenspiel
adult|Porno|Liebesfilm
adult|Freundschaft Plus|Fernbeziehung
adult|Saunaclub|Massagesalon
`;
