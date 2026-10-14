/*
 * Pi mal Daumen – Fragen „Über uns“: Die Antwort wird live in der Runde ermittelt.
 * Format: Frage | sum oder count | Einheit | Frage an jede Person
 *   sum:   Jede Person nennt eine Zahl, die Antwort ist die Summe.
 *   count: Jede Person sagt Ja oder Nein, die Antwort ist die Anzahl der Ja-Antworten.
 * Zeilen mit # werden ignoriert.
 */
window.PMD_FRAGEN = window.PMD_FRAGEN || {};
window.PMD_FRAGEN.uns = `
# Summen
Wie viele Geschwister habt ihr alle zusammen? | sum | Geschwister | Wie viele Geschwister hast du?
Wie alt seid ihr alle zusammen? | sum | Jahre | Wie alt bist du?
Wie viele Länder habt ihr zusammengezählt schon besucht? | sum | Länder | In wie vielen Ländern warst du schon?
Wie viele Apps sind auf euren Handys zusammen installiert? | sum | Apps | Wie viele Apps hast du auf dem Handy? (Nachschauen erlaubt!)
Wie viele Kontakte habt ihr zusammen im Handy gespeichert? | sum | Kontakte | Wie viele Kontakte hast du im Handy?
Wie viele Fotos sind auf euren Handys zusammen gespeichert? | sum | Fotos | Wie viele Fotos sind auf deinem Handy?
Wie viel Prozent Akku haben eure Handys gerade zusammen? | sum | % | Wie viel Prozent Akku hat dein Handy gerade?
Wie viele ungelesene E-Mails habt ihr zusammen? | sum | E-Mails | Wie viele ungelesene E-Mails hast du?
Wie viele WhatsApp-Gruppen habt ihr zusammen? | sum | Gruppen | In wie vielen WhatsApp-Gruppen bist du?
Wie viele Paar Schuhe besitzt ihr zusammen? | sum | Paar | Wie viele Paar Schuhe besitzt du?
Wie viele Haustiere habt ihr zusammen? | sum | Tiere | Wie viele Haustiere hast du?
Wie viele Stunden habt ihr letzte Nacht zusammen geschlafen? | sum | Stunden | Wie viele Stunden hast du letzte Nacht geschlafen?
Wie groß seid ihr alle zusammen (in Zentimetern)? | sum | cm | Wie groß bist du in Zentimetern?
Wie groß ist die Summe eurer Schuhgrößen? | sum | | Welche Schuhgröße hast du?
Wie viele Tassen Kaffee habt ihr heute zusammen getrunken? | sum | Tassen | Wie viele Tassen Kaffee hast du heute getrunken?
Wie viele Bücher habt ihr im letzten Jahr zusammen gelesen? | sum | Bücher | Wie viele Bücher hast du im letzten Jahr gelesen?
Wie oft seid ihr zusammengezählt schon umgezogen? | sum | Umzüge | Wie oft bist du schon umgezogen?
Wie viele Jahre habt ihr zusammen schon den Führerschein? | sum | Jahre | Seit wie vielen Jahren hast du den Führerschein? (keinen = 0)
Wie viele Tattoos habt ihr zusammen? | sum | Tattoos | Wie viele Tattoos hast du?
Wie viele Piercings habt ihr zusammen (ohne Ohrlöcher)? | sum | Piercings | Wie viele Piercings hast du (ohne Ohrlöcher)?
Wie viele Musikinstrumente könnt ihr zusammen spielen? | sum | Instrumente | Wie viele Instrumente kannst du (wenigstens ein bisschen) spielen?
Wie viele Sprachen sprecht ihr zusammengezählt? | sum | Sprachen | Wie viele Sprachen sprichst du (gut genug für ein Gespräch)?
Wie viele Kilometer wohnt ihr zusammengezählt von hier entfernt? | sum | km | Wie viele Kilometer wohnst du von hier entfernt?
Wie viele Euro Bargeld habt ihr gerade zusammen dabei? | sum | Euro | Wie viel Bargeld hast du gerade dabei (in Euro)?
Wie viele Münzen sind in euren Portemonnaies zusammen? | sum | Münzen | Wie viele Münzen sind in deinem Portemonnaie?
Wie viele Karten (Bank, Ausweis, Kundenkarten …) habt ihr zusammen im Portemonnaie? | sum | Karten | Wie viele Karten sind in deinem Portemonnaie?
Wie viele Schlüssel hängen an euren Schlüsselbunden zusammen? | sum | Schlüssel | Wie viele Schlüssel hängen an deinem Schlüsselbund?
Wie viele Schmuckstücke tragt ihr gerade zusammen? | sum | Stück | Wie viele Schmuckstücke (Ringe, Ketten, Ohrringe, Uhren …) trägst du gerade?
Wie viele Knöpfe sind an eurer Kleidung gerade zusammen? | sum | Knöpfe | Wie viele Knöpfe sind an deiner Kleidung gerade?
Wie viele Cousins und Cousinen habt ihr zusammen? | sum | Cousins | Wie viele Cousins und Cousinen hast du?
Wie viele eurer Großeltern leben noch? | sum | Großeltern | Wie viele deiner Großeltern leben noch?
Wie viele Flüge seid ihr im letzten Jahr zusammen geflogen? | sum | Flüge | Wie viele Flüge (einzelne Strecken) bist du im letzten Jahr geflogen?
Auf wie vielen Konzerten wart ihr im letzten Jahr zusammen? | sum | Konzerte | Auf wie vielen Konzerten warst du im letzten Jahr?
Wie oft wart ihr im letzten Jahr zusammengezählt im Kino? | sum | Kinobesuche | Wie oft warst du im letzten Jahr im Kino?
Wie viele Knochenbrüche hattet ihr zusammen schon? | sum | Brüche | Wie viele Knochenbrüche hattest du schon?
Wie viele Zimmerpflanzen habt ihr zusammen? | sum | Pflanzen | Wie viele Zimmerpflanzen hast du?
Wie viele Fahrräder besitzt ihr zusammen? | sum | Fahrräder | Wie viele Fahrräder besitzt du?
Wie viele Handys hattet ihr zusammen schon in eurem Leben? | sum | Handys | Wie viele Handys hattest du schon?
Wie viele Schritte seid ihr heute zusammen gegangen? | sum | Schritte | Wie viele Schritte bist du heute gegangen? (Handy fragen!)
Wie groß ist die Summe eurer Geburtsmonate (Januar = 1 … Dezember = 12)? | sum | | In welchem Monat hast du Geburtstag (1–12)?
Wie groß ist die Summe eurer Geburtstage (nur der Tag im Monat)? | sum | | An welchem Tag im Monat hast du Geburtstag (1–31)?
Wie groß ist die Summe der letzten beiden Ziffern eurer Handynummern? | sum | | Was sind die letzten beiden Ziffern deiner Handynummer (als Zahl, z. B. 47)?
Wie groß ist die Summe eurer Hausnummern? | sum | | Was ist deine Hausnummer?
Wie viele Stunden Sport macht ihr zusammen pro Woche? | sum | Stunden | Wie viele Stunden Sport machst du pro Woche?
Wie viele verschiedene Jobs (inklusive Nebenjobs) hattet ihr zusammen schon? | sum | Jobs | Wie viele verschiedene Jobs hattest du schon?
Wie viele Stunden spielt ihr zusammen pro Woche Videospiele? | sum | Stunden | Wie viele Stunden spielst du pro Woche Videospiele?
In wie vielen verschiedenen Städten habt ihr zusammengezählt schon gewohnt? | sum | Städte | In wie vielen verschiedenen Städten hast du schon gewohnt?
Wie viele Minuten Bildschirmzeit hatten eure Handys gestern zusammen? | sum | Minuten | Wie viele Minuten Bildschirmzeit hatte dein Handy gestern? (Einstellungen!)
Wie viele Streaming-Abos habt ihr zusammen? | sum | Abos | Wie viele Streaming-Abos (Netflix, Spotify …) hast du?
Wie viele Paar Socken besitzt ihr zusammen ungefähr? | sum | Paar | Wie viele Paar Socken besitzt du ungefähr?
Wie viele Brettspiele besitzt ihr zusammen? | sum | Spiele | Wie viele Brettspiele besitzt du?
Wie viele Kuscheltiere besitzt ihr noch zusammen? | sum | Kuscheltiere | Wie viele Kuscheltiere besitzt du noch?
Wie viele Stunden habt ihr heute zusammen schon am Handy verbracht? | sum | Stunden | Wie viele Stunden warst du heute schon am Handy?
Wie viele Nachrichten habt ihr heute zusammen schon verschickt? | sum | Nachrichten | Wie viele Nachrichten hast du heute schon verschickt (ungefähr)?
Wie viele Länder Europas habt ihr zusammengezählt schon besucht? | sum | Länder | Wie viele Länder Europas hast du schon besucht?
Wie viele Bundesländer habt ihr zusammengezählt schon besucht? | sum | Bundesländer | Wie viele der 16 Bundesländer hast du schon besucht?
Wie viele Stunden habt ihr zusammen heute schon gearbeitet oder gelernt? | sum | Stunden | Wie viele Stunden hast du heute schon gearbeitet oder gelernt?
Wie viele Jahre wart ihr zusammen in der Schule? | sum | Jahre | Wie viele Jahre warst du in der Schule?
Wie viele Geburtstagspartys habt ihr dieses Jahr zusammen besucht? | sum | Partys | Auf wie vielen Geburtstagspartys warst du dieses Jahr?
Wie viele Euro habt ihr zusammen zuletzt für einen Haarschnitt bezahlt? | sum | Euro | Wie viel hast du für deinen letzten Haarschnitt bezahlt (in Euro)?
# Ja / Nein
Wie viele von euch tragen eine Brille oder Kontaktlinsen? | count | Personen | Trägst du eine Brille oder Kontaktlinsen?
Wie viele von euch sind Einzelkinder? | count | Personen | Bist du ein Einzelkind?
Wie viele von euch haben ein Tattoo? | count | Personen | Hast du ein Tattoo?
Wie viele von euch waren schon in den USA? | count | Personen | Warst du schon mal in den USA?
Wie viele von euch können einen Handstand? | count | Personen | Kannst du einen Handstand (ohne Wand)?
Wie viele von euch sind im Sommer (Juni bis August) geboren? | count | Personen | Bist du im Juni, Juli oder August geboren?
Wie viele von euch haben heute schon Kaffee getrunken? | count | Personen | Hast du heute schon Kaffee getrunken?
Wie viele von euch haben heute schon Sport gemacht? | count | Personen | Hast du heute schon Sport gemacht?
Wie viele von euch haben ein Haustier? | count | Personen | Hast du ein Haustier?
Wie viele von euch sind Linkshänder? | count | Personen | Bist du Linkshänder/in?
Wie viele von euch können auf zwei Fingern pfeifen? | count | Personen | Kannst du auf zwei Fingern pfeifen?
Wie viele von euch haben sich schon mal einen Knochen gebrochen? | count | Personen | Hast du dir schon mal einen Knochen gebrochen?
Wie viele von euch haben einen Autoführerschein? | count | Personen | Hast du einen Autoführerschein?
Wie viele von euch essen vegetarisch oder vegan? | count | Personen | Isst du vegetarisch oder vegan?
Wie viele von euch können die Zunge rollen? | count | Personen | Kannst du die Zunge zu einer Röhre rollen?
Wie viele von euch haben ein iPhone? | count | Personen | Hast du ein iPhone?
Wie viele von euch haben schon mal in einer WG gewohnt? | count | Personen | Hast du schon mal in einer WG gewohnt?
Wie viele von euch haben Höhenangst? | count | Personen | Hast du Höhenangst?
Wie viele von euch haben noch alle Weisheitszähne? | count | Personen | Hast du noch alle Weisheitszähne?
Wie viele von euch sind schon mal auf einem Pferd geritten? | count | Personen | Bist du schon mal geritten?
Wie viele von euch sprechen mehr als zwei Sprachen? | count | Personen | Sprichst du mehr als zwei Sprachen?
Wie viele von euch waren schon mal im Fernsehen zu sehen? | count | Personen | Warst du schon mal im Fernsehen zu sehen?
Wie viele von euch haben ein Piercing (ohne Ohrlöcher)? | count | Personen | Hast du ein Piercing (ohne Ohrlöcher)?
Wie viele von euch können Schach spielen? | count | Personen | Kannst du Schach spielen (die Regeln reichen)?
Wie viele von euch sind schon einen Halbmarathon oder Marathon gelaufen? | count | Personen | Bist du schon einen Halbmarathon oder Marathon gelaufen?
Wie viele von euch sind Fan eines Fußballvereins? | count | Personen | Bist du Fan eines Fußballvereins?
Wie viele von euch haben schon mal einen Promi getroffen? | count | Personen | Hast du schon mal einen Promi getroffen?
Wie viele von euch wohnen noch bei den Eltern? | count | Personen | Wohnst du noch bei deinen Eltern?
Wie viele von euch waren schon mal auf einem Festival? | count | Personen | Warst du schon mal auf einem Musikfestival?
Wie viele von euch schlafen bei offenem Fenster? | count | Personen | Schläfst du meistens bei offenem Fenster?
Wie viele von euch haben schon mal einen Strafzettel bekommen? | count | Personen | Hast du schon mal einen Strafzettel bekommen?
Wie viele von euch können kochen, ohne ins Rezept zu schauen? | count | Personen | Kannst du ein Gericht ohne Rezept kochen?
Wie viele von euch sind schon mal aus einem Flugzeug gesprungen oder Bungee gesprungen? | count | Personen | Bist du schon mal Fallschirm oder Bungee gesprungen?
Wie viele von euch haben heute Socken mit Muster an? | count | Personen | Trägst du gerade Socken mit Muster?
Wie viele von euch haben schon mal im Lotto etwas gewonnen? | count | Personen | Hast du schon mal im Lotto etwas gewonnen?
Wie viele von euch sind Frühaufsteher? | count | Personen | Bist du eher Frühaufsteher/in?
Wie viele von euch haben schon mal einen Film im Kino zweimal gesehen? | count | Personen | Hast du schon mal einen Film zweimal im Kino gesehen?
Wie viele von euch können schwimmen? | count | Personen | Kannst du schwimmen?
Wie viele von euch haben ein Instrument gelernt? | count | Personen | Hast du mal ein Instrument gelernt?
Wie viele von euch haben schon mal einen Baum gepflanzt? | count | Personen | Hast du schon mal einen Baum gepflanzt?
Wie viele von euch waren schon mal in Asien? | count | Personen | Warst du schon mal in Asien?
Wie viele von euch haben heute schon gelacht, bis ihnen Tränen kamen? | count | Personen | Hast du heute schon Tränen gelacht?
Wie viele von euch haben ein Lieblingsessen, das sie fast jede Woche essen? | count | Personen | Isst du dein Lieblingsessen fast jede Woche?
Wie viele von euch haben schon mal etwas Wichtiges in der Bahn oder im Taxi liegen lassen? | count | Personen | Hast du schon mal etwas Wichtiges in Bahn oder Taxi liegen lassen?
Wie viele von euch haben schon mal einen Pokal oder eine Medaille gewonnen? | count | Personen | Hast du schon mal einen Pokal oder eine Medaille gewonnen?
Wie viele von euch können Fahrrad fahren, ohne die Hände am Lenker? | count | Personen | Kannst du freihändig Fahrrad fahren?
Wie viele von euch haben schon mal eine Nacht durchgemacht? | count | Personen | Hast du schon mal eine ganze Nacht durchgemacht?
Wie viele von euch tragen gerade etwas Schwarzes? | count | Personen | Trägst du gerade etwas Schwarzes?
Wie viele von euch haben heute schon geduscht? | count | Personen | Hast du heute schon geduscht?
Wie viele von euch haben einen Spitznamen, den fast alle benutzen? | count | Personen | Hast du einen Spitznamen, den fast alle benutzen?
Wie viele von euch haben schon mal eine Wette verloren und mussten etwas Peinliches tun? | count | Personen | Musstest du schon mal wegen einer verlorenen Wette etwas Peinliches tun?
`;
