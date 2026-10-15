/*
 * Fragen für den Frage-Modus von „Imposter“ – eine Zeile pro Paar: Crew-Frage|Imposter-Frage
 * Die Imposter-Frage muss eine ähnliche Art von Antwort haben (Zahl ↔ Zahl, Essen ↔ Essen, Ort ↔ Ort …),
 * damit der Imposter mit seiner Antwort nicht sofort auffällt – aber eben doch ein bisschen.
 * standard: immer dabei · adult: nur wenn die Kategorie 18+ ausgewählt ist
 * Zeilen mit # werden ignoriert.
 */
window.IM_WORDS = window.IM_WORDS || {};
window.IM_WORDS.fragen = `
Wie viele Stunden schläfst du pro Nacht?|Wie viele Stunden darf ein Kinofilm höchstens dauern?
Was ist dein Lieblingsessen?|Was würdest du nie essen?
Wie viele Geschwister hättest du gern?|Wie viele Haustiere hättest du gern?
Wohin würdest du gern mal reisen?|Wo warst du zuletzt im Urlaub?
Wie viele Tassen Kaffee trinkst du am Tag?|Wie viele Stunden Sport machst du pro Woche?
Welches Tier wärst du gern?|Welches Tier findest du am ekligsten?
Wie alt fühlst du dich?|In welchem Alter sollte man spätestens heiraten?
Welches Auto würdest du gern fahren?|Welches Auto fährt deine Familie?
Wie viele Paar Schuhe besitzt du?|Wie viele Jacken besitzt du?
Wie viel Euro würdest du höchstens für ein Konzertticket ausgeben?|Wie viel Euro kostet ein gutes Abendessen für zwei?
Welche Superkraft hättest du gern?|Welche Fähigkeit würdest du gern lernen?
Was ist dein Lieblingsfilm?|Welchen Film hast du zuletzt gesehen?
Welchen Promi würdest du gern mal treffen?|Welcher Promi nervt dich am meisten?
Um wie viel Uhr stehst du am Wochenende auf?|Um wie viel Uhr isst du zu Mittag?
Wie viele Minuten brauchst du morgens im Bad?|Wie viele Minuten brauchst du zur Arbeit oder Schule?
Was ist dein Lieblingsgetränk?|Was trinkst du auf Partys am liebsten?
Welche Farbe hat dein Lieblingspullover?|Welche Farbe würdest du nie anziehen?
In welchem Land machst du am liebsten Urlaub?|In welchem Land möchtest du nie leben?
Welches Hobby hast du?|Welches Hobby würdest du gern anfangen?
Wie viele Apps hast du auf dem Handy?|Wie viele ungelesene Nachrichten hast du gerade?
Was isst du zum Frühstück?|Was isst du als Mitternachtssnack?
Wie viele Stunden am Tag bist du am Handy?|Wie viele Stunden am Tag sitzt du?
Welches Instrument würdest du gern spielen?|Welches Instrument nervt dich am meisten?
Welcher Wochentag ist dein Lieblingstag?|An welchem Wochentag gehst du am liebsten feiern?
Was würdest du mit einer Million Euro machen?|Was hast du zuletzt Teures gekauft?
In welchem Monat hast du Geburtstag?|In welchem Monat machst du am liebsten Urlaub?
Welche Sportart schaust du am liebsten?|Welche Sportart hast du in der Schule gehasst?
Wie viele Länder hast du schon besucht?|Wie viele Sprachen würdest du gern sprechen?
Was ist dein Lieblingsgemüse?|Welches Gemüse magst du gar nicht?
Welche Pizza bestellst du am liebsten?|Was legst du am liebsten auf ein Brot?
Welcher Song läuft bei dir gerade in Dauerschleife?|Welcher Song ist dein Party-Hit?
Was war dein Traumberuf als Kind?|Welchen Beruf würdest du nie machen?
Wie viele Kinder möchtest du mal haben?|Wie viele Personen passen in dein Auto?
Wie heißt oder hieß dein Haustier?|Wie würdest du einen Hund nennen?
Was ist dein Lieblingsbrettspiel?|Bei welchem Spiel verlierst du immer?
Welche Serie schaust du gerade?|Welche Serie würdest du nochmal von vorn schauen?
Was nimmst du mit auf eine einsame Insel?|Was hast du immer in der Tasche dabei?
Was ist dein Lieblingsduft?|Welchen Geruch findest du eklig?
Wie viele Kugeln Eis nimmst du?|Wie viele Stück Kuchen schaffst du?
Ab wie viel Grad gehst du draußen baden?|Bei wie viel Grad ist es dir in der Wohnung zu kalt?
Welches Märchen magst du am liebsten?|Welcher Disneyfilm hat dich als Kind geprägt?
Wie viele Stunden könntest du ohne Handy aushalten?|Wie viele Stunden dauerte deine längste Autofahrt?
Welche Stadt in Deutschland magst du am liebsten?|In welcher Stadt in Deutschland warst du zuletzt?
Was ist dein Lieblingsessen bei Oma?|Was kochst du, wenn Gäste kommen?
Was würdest du als Erstes retten, wenn es brennt?|Was ist dein wertvollster Besitz?
Welches Gericht kannst du am besten kochen?|Was bestellst du beim Lieferdienst?
Wie oft im Monat gehst du essen?|Wie oft im Monat gehst du feiern?
Mit welchem Promi würdest du gern einen Tag tauschen?|Welcher Promi wäre ein guter Bundeskanzler?
Welches Schulfach mochtest du am liebsten?|Welches Schulfach würdest du heute gern nochmal belegen?
Wie hieß dein erster Schwarm?|Wie hieß dein bester Freund in der Grundschule?
Welches Land hat das beste Essen?|Welches Land würdest du gern bereisen?
Was ist das Erste, was du morgens machst?|Was ist das Letzte, was du abends machst?
Wie viele Wecker stellst du dir?|Wie oft drückst du morgens auf Schlummern?
Welches Tier hättest du gern als Haustier?|Welches Tier würdest du gern mal in freier Wildbahn sehen?
Was ist dein Lieblingsfeiertag?|Welchen Feiertag könnte man abschaffen?
Wie viele Leute lädst du zu deinem Geburtstag ein?|Wie viele Leute passen in deine Wohnung?
Wie viele Stunden schläfst du am Wochenende?|Wie viele Stunden fährst du höchstens am Stück Auto?
Welche Eissorte magst du am liebsten?|Welche Eissorte würdest du nie nehmen?
Was wäre deine Henkersmahlzeit?|Was isst du, wenn du krank bist?
Was bestellst du in einer Bar?|Was trinkst du, wenn du verkatert bist?
Welche Jahreszeit magst du am liebsten?|In welcher Jahreszeit hast du Geburtstag?
Wie viel Euro darf dein Traumurlaub kosten?|Wie viel Euro gibst du im Monat für Essen aus?
Welchen Film kannst du immer wieder schauen?|Bei welchem Film hast du geweint?
Wie viele Kilometer bist du am Stück gelaufen?|Wie viele Kilometer wohnst du von deinen Eltern entfernt?
Was hast du als Kind am liebsten gespielt?|Welches Handyspiel hast du zuletzt gespielt?
Was ist dein Lieblingsobst?|Welches Obst isst du im Sommer?
Wie viele Minuten duschst du?|Wie viele Minuten brauchst du zum Einschlafen?
Welche Marke trägst du am liebsten?|Welche Marke findest du überteuert?
Was war dein schönstes Geschenk?|Was wünschst du dir zum Geburtstag?
Welches Wort sagst du zu oft?|Welches Wort findest du besonders schön?
Wen rufst du als Erstes an, wenn etwas passiert?|Mit wem schreibst du am meisten?
In welchem Jahrzehnt würdest du gern leben?|Welches Jahrzehnt hatte die beste Musik?
Welche Band oder welchen Sänger hörst du am liebsten?|Wen würdest du nie live sehen wollen?
Wie viele Gläser Wasser trinkst du am Tag?|Wie viele Snacks isst du am Tag?
Welchen Spitznamen hattest du als Kind?|Wie würdest du dein Kind nennen?
Wo verbringst du am liebsten das Wochenende?|Wo verbringst du die meiste Zeit?
Wie viele Tage dauert dein perfekter Urlaub?|Wie viele Tage könntest du ohne Internet leben?
Welches Emoji benutzt du am häufigsten?|Welches Emoji findest du nervig?
Um wie viel Uhr gehst du unter der Woche ins Bett?|Ab wie viel Uhr ist es für dich „spät“ am Abend?
Wie viele Gäste hätte deine Traumhochzeit?|Wie viele Leute folgst du auf Instagram?
Was ist dein Lieblingssnack beim Fernsehen?|Was isst du im Kino?
Welches Gesellschaftsspiel spielst du am liebsten?|Welches Spiel hast du als Kind gehasst?
Was gibt es bei dir an Weihnachten zu essen?|Was gibt es bei dir an Silvester zu essen?
Wie viele Stunden pro Woche schaust du Serien?|Wie viele Stunden pro Woche bist du draußen?
Welches Land würdest du zum Auswandern wählen?|Welches Land hat die schönste Flagge?
Welches Tier findest du am süßesten?|Welches Tier hättest du gern als Kuscheltier?
`;

window.IM_WORDS.fragenAdult = `
Wie viele Dates hattest du dieses Jahr?|Auf wie vielen Partys warst du dieses Jahr?
Wie viele Shots verträgst du?|Wie viele Bier trinkst du an einem Abend?
Mit wie vielen Leuten hast du schon geknutscht?|Wie viele Exfreunde oder Exfreundinnen hast du?
Wie alt warst du bei deinem ersten Kuss?|Wie alt warst du, als du das erste Mal betrunken warst?
Was ist dein Lieblingsdrink?|Wovon hattest du den schlimmsten Kater?
Wo war dein verrücktestes Date?|Wo würdest du gern mal übernachten?
Welchen Promi findest du heiß?|Welcher Promi wäre ein guter Partner fürs Leben?
Was ist bei einem Date ein No-Go?|Was nervt dich an Mitbewohnern?
Wie viele Stunden hast du höchstens durchgefeiert?|Wie viele Stunden hast du höchstens am Stück geschlafen?
Was trägst du am liebsten im Bett?|Was trägst du am liebsten zu Hause?
Was war dein peinlichstes Erlebnis im Suff?|Was war dein peinlichstes Erlebnis in der Schule?
Wie viele Leute hast du schon über Dating-Apps getroffen?|Wie viele Leute hast du auf Partys kennengelernt?
Welche Körperstelle findest du am attraktivsten?|Welche Körperstelle wäschst du beim Duschen zuerst?
Wie oft pro Woche hättest du gern Sex?|Wie oft pro Woche machst du Sport?
Wo knutschst du am liebsten?|Wo entspannst du am liebsten?
Wie viele Minuten sollte das perfekte Vorspiel dauern?|Wie viele Minuten dauert dein perfektes Frühstück?
Was ist dein Lieblingsgetränk zum Vorglühen?|Was trinkst du zum Abendessen?
Wie viele Leute hast du schon nackt gesehen (außer Familie)?|Wie viele Leute hast du schon beim Schnarchen gehört?
`;
