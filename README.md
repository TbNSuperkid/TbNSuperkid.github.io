# 🎲 MiniGames

Unsere Spieleseite für Spieleabende mit Freunden: **https://tbnsuperkid.github.io/**

Beim Öffnen der Seite erscheint die Spieleauswahl. Jedes Spiel liegt in einem eigenen Ordner.

| Spiel                    | Ordner        | Adresse                                     |
| ------------------------ | ------------- | ------------------------------------------- |
| Guess the word!          | `guess-the-word/` | https://tbnsuperkid.github.io/guess-the-word/ |
| 2 Dumme, 1 Gedanke       | `zwei-dumme/` | https://tbnsuperkid.github.io/zwei-dumme/   |
| Pi mal Daumen            | `pi-mal-daumen/` | https://tbnsuperkid.github.io/pi-mal-daumen/ |
| Geheimsache              | `geheimsache/` | https://tbnsuperkid.github.io/geheimsache/ |
| Imposter                 | `imposter/`   | https://tbnsuperkid.github.io/imposter/     |
| Prost! (ab 18)           | `prost/`      | https://tbnsuperkid.github.io/prost/        |
| Who knows more?          | `who-knows-more/` | https://tbnsuperkid.github.io/who-knows-more/ |
| Pferderennen (ab 18)     | `pferderennen/` | https://tbnsuperkid.github.io/pferderennen/ |
| Farbgefühl               | `farbgefuehl/` | https://tbnsuperkid.github.io/farbgefuehl/ |
| Schlecht erklärt         | `schlecht-erklaert/` | https://tbnsuperkid.github.io/schlecht-erklaert/ |
| Nur einer                | `nur-einer/`  | https://tbnsuperkid.github.io/nur-einer/    |
| Wavelength               | `wavelength/` | https://tbnsuperkid.github.io/wavelength/   |
| Skribbl                  | `skribbl/`    | https://tbnsuperkid.github.io/skribbl/      |
| Flüsterpost              | `fluesterpost/` | https://tbnsuperkid.github.io/fluesterpost/ |
| Stadt, Land, Fluss       | `stadt-land-fluss/` | https://tbnsuperkid.github.io/stadt-land-fluss/ |

### Neues Spiel hinzufügen

1. Einen neuen Ordner anlegen, z. B. `quiz/`, mit einer eigenen `index.html`
   - gemeinsame Bibliotheken & Schriften liegen in `vendor/` (erreichbar über `../vendor/…`)
   - gemeinsamer Code liegt in `shared/`: Handy-Verbindung (`room.js` auf Basis von `net.js`),
     Sounds & Konfetti (`fx.js`, eigene Sounds über `GameFx.synth`), Zeichenfläche (`sketch.js`) und `config.js`
   - Handys einbinden: In `js/controllers.js` ein Kit holen, z. B.
     `GameRoom.create({ game: 'quiz', net: 'quiz-v1-', storage: 'quiz', engine: QuizEngine })`.
     Es liefert `StageController` (Laptop/Bühne) und `ClientController` (Handy) inklusive Raum-Code,
     QR-Code (`qrSvg`, `inviteLink`), Wiederverbinden und Speichern. Die Engine braucht dafür
     `connect`, `disconnect`, `apply`, `viewFor` usw. (siehe Kopf von `shared/room.js`)
2. In der `index.html` im Hauptordner eine weitere Spielkarte (`<a class="game" …>`) einfügen
3. Für den Node-Server den Ordner in `server/server.js` bei `PUBLIC_DIRS` eintragen

---

## 2 Dumme, 1 Gedanke

Das Gedankenlese-Spiel für Teams. Ein **Laptop** (oder Tablet/Fernseher) ist die **Bühne** und zeigt Begriffe,
Aufdecken und Punktestand. Gespielt wird mit 1–4 Teams über eine feste Zahl an Durchgängen –
wer am Ende die wenigsten Punkte hat, hat verloren. Bei Gleichstand an der Spitze gibt es ein **Stechen**.

**Zwei Modi**

- **🎯 Ein Begriff:** Alle sehen einen Begriff (z. B. „Strand“), jede/r im Team nennt ein Wort dazu.
  Alle gleich = 3 Punkte, mindestens zwei gleich = 1, keiner = 0. Optional **Zweite Chance**: Brücke zwischen
  den eigenen Wörtern suchen, geschafft = 2 Punkte.
- **🔗 Gedankenkette:** Das ganze Team nennt gleichzeitig irgendein Wort und sucht dann Runde für Runde ein Wort,
  das die letzten Wörter verbindet – bis alle dasselbe sagen. Treffer in Runde 1 = 5 Punkte, 2 = 4, 3 = 3,
  4 = 2, danach 1. Schon genannte Wörter sind gesperrt, optional gibt die App zwei Startwörter vor.

**Zwei Spielweisen**

- **🗣️ Ohne Handy:** Die Teams sind nacheinander dran. Countdown 3 – 2 – 1, das Team ruft gleichzeitig,
  am Laptop wird das Ergebnis angeklickt (bei der Kette können die Wörter auch eingetippt werden).
- **✍️ Mit Handy:** Alle scannen den QR-Code am Laptop, wählen ihr Team und tippen geheim.
  Alle Teams spielen gleichzeitig, aufgedeckt wird auf dem Laptop. Wer kurz die Verbindung verliert,
  wird 15 Sekunden abgewartet.

Gleich ist gleich: Groß/klein, Artikel, Plural (Rakete = Raketen) und kleine Tippfehler bei längeren Wörtern
spielen keine Rolle. Die ca. 350 Begriffe liegen in `zwei-dumme/js/words/begriffe.js`
(Einzelbegriffe, Kategorien, Lückensätze – eine Zeile pro Begriff).

---

## Pi mal Daumen

Das Schätz-Quiz: *„Wie hoch ist der Eiffelturm?“*, *„In welchem Jahr fiel die Mauer?“*, *„Wie viele Geschwister habt
ihr alle zusammen?“* – wer am nächsten dran ist, gewinnt die Runde. Wie bei „2 Dumme“ ist ein **Laptop** die **Bühne**:
Er zeigt die Frage, deckt die Schätzungen als farbige Nadeln auf einem **Zahlenstrahl** auf und führt den Punktestand.
Gespielt wird in 1–4 Teams oder **jeder für sich** (bis 12 Personen), über eine feste Zahl an Fragen mit **Stechen**
bei Gleichstand.

- **🗣️ Ohne Handy (reihum):** Die Teams nennen ihre Schätzung nacheinander laut, jede Zahl nur einmal – wer zuletzt
  dran ist, kann taktisch knapp drüber oder drunter setzen. Am Laptop wird eingetragen.
- **✍️ Mit Handy:** QR-Code scannen und geheim tippen – pro Team in ein **gemeinsames Feld** (alle sehen live, was drinsteht)
  oder jede/r für sich, dann zählt der **Median** des Teams. Das erste verbundene Handy ist die **Spielleitung** und kann
  nach dem Aufdecken weiterschalten (praktisch, wenn die Bühne ein Fernseher ist).
- **Wertung:** *Rang* (1 Punkt für jedes Team, das weiter weg liegt, + 2 für einen Volltreffer mit höchstens 1 % Abweichung,
  bei Jahreszahlen genau) oder *Genauigkeit* (0–5 Punkte nach eigener Abweichung). Dazu ein **🃏 Joker** pro Team,
  der die Punkte einer Frage verdoppelt.
- **🫵 Über uns:** Fragen über die Runde selbst – mit Handy beantwortet jede/r geheim die Frage über sich, ohne Handy
  wird nach dem Schätzen durchgezählt.
- Zahlen dürfen wie gewohnt eingegeben werden: `1.500`, `1,5 Tsd`, `2 Mio`, `3,2 Mrd`, `753 v. Chr.`

Über 1000 Fragen in `pi-mal-daumen/js/fragen/` – eine Datei pro Kategorie (Erde, Geschichte, Natur, Mensch, Technik,
Alltag, Sport, Pop, 18+ und Über uns), eine Zeile pro Frage: `Frage | Antwort | Einheit | Fun Fact`.
Die Einheit `Jahr` steht für Jahreszahlen. 18+ ist beim Anlegen standardmäßig ausgeschaltet.

---

## Geheimsache

Zwei Teams (🔴 Rot, 🔵 Blau), **25 Wörter**, ein ☠️ **Attentäter**. Nur die beiden **Geheimdienstchefs** kennen die
Schlüsselkarte (9 Karten Startteam, 8 anderes Team, 7 Unbeteiligte, 1 Attentäter) und geben reihum einen Hinweis aus
**einem Wort und einer Zahl** (*„Wasser, 3“*). Ihr Team deckt höchstens Zahl + 1 Karten auf – eigene Farbe: weiter,
unbeteiligt oder Gegnerfarbe: Zug vorbei, Attentäter: sofort verloren. Wer zuerst alle eigenen Karten hat, gewinnt.
„0“ und „∞“ als Zahl erlauben unbegrenztes Raten.

- **📲 Nur Chef-Handys (Standard):** Der Laptop ist das Spielfeld und wird wie das Brettspiel bedient (Zahl des Hinweises
  anklicken, Karten zweimal anklicken = aufdecken). Die Chefs scannen den **🔑-QR-Code**: Er enthält die Schlüsselkarte
  selbst im Link-Anker (`geheimsache/#k=…`, ca. 80 Zeichen, wird nie an einen Server geschickt) – das Handy braucht
  weder Raum noch Internet. Mit Internet öffnet der Laptop nebenbei einen Raum und der QR-Code enthält zusätzlich
  den Raum-Code (`&r=…&g=…`): Dann sagt der Chef den Hinweis laut, stellt auf dem Handy die Anzahl ein und drückt
  **„🗣️ Hinweis gegeben“** (gilt nur mit dem Schlüssel der laufenden Partie). Notlösung ohne Handy: Schlüssel kurz am
  Laptop einblenden.
- **📱 Alle mit Handy:** Raum + Lobby wie bei 2 Dumme. Der Chef tippt den Hinweis ein – oder sagt ihn laut am Tisch und
  drückt nur **„🗣️ Hinweis gegeben“** mit der Anzahl (Wörter auf dem Feld, Teilwörter
  und Plural werden abgelehnt: *Schloss* ↔ *Schlosspark*, *Bank* ↔ *Bänke*), Ermittler:innen schlagen Karten vor
  (Name erscheint auf der Karte, auch am Laptop) und decken auf. Farben verdeckter Karten sehen nur die Chefs.
- **Partien:** 1, Best of 3, Best of 5 oder frei. Nach jeder Partie wechseln die Chefs reihum (am Laptop änderbar).
  Optional **Sanduhr** für Chef und Team (1–3 Min) – ist sie abgelaufen, ist das andere Team dran.
- **🍻 Trinkregeln** (optional, auch alkoholfrei mit Strafpunkten): Unbeteiligte 1, Gegnerkarte ganzes Team 1,
  Attentäter 3, Hinweis für 3+ komplett gelöst → Gegner 1, Partie verloren → 1 pro übriger Karte.
- Am Ende des Abends: Gesamtstand und Auszeichnungen (🧠 Meisterhinweis, ☠️ Pechvogel, 🎯 Sauberes Team …).

- **🔞 Wörter:** Standard oder „+ 18+“ – dann liegen pro Partie 8 Wörter ab 18 (Party, Alkohol, Liebe & Sex) zwischen den normalen.

Die 500 normalen Wörter liegen in `geheimsache/js/words/woerter.js`, die 130 Wörter ab 18 in `geheimsache/js/words/adult.js`
(ein Wort pro Zeile, neue Wörter bitte nur anhängen – der QR-Code merkt sich die Wörter als Nummern, 18+ ab Nummer 900).
`npm test` prüft u. a., dass kein Wort in einem anderen steckt – auch nicht zwischen den beiden Listen.

---

## Imposter

Alle bekommen dasselbe geheime Wort – **außer dem Imposter**. Reihum sagt jede Person **ein Wort** dazu, dann wird diskutiert
und gleichzeitig abgestimmt. Wer die meisten Stimmen hat, fliegt raus und wird aufgedeckt. War es der Imposter, darf er noch
**das Wort raten** – richtig geraten klaut er den Sieg (Plural und kleine Tippfehler zählen, „Pilot“ = „Pilot:in“).
Gespielt wird einzeln mit **3–15 Personen**.

- **📲 Ein Gerät (Standard):** Namen in Sitzreihenfolge eintragen, „Gib das Gerät an Anna“ → Aufdecken → Verstanden → weiter.
  Danach zeigt das Gerät Reihenfolge und Timer. Abgestimmt wird per Countdown 3 – 2 – 1 und Zeigen, am Gerät wird angetippt,
  wer die meisten Stimmen hat (mehrere = Gleichstand). Läuft komplett offline.
- **📱 Jeder ein Handy:** Raum + QR-Code wie bei den anderen Spielen. Die eigene Karte ist jederzeit per **Gedrückthalten**
  sichtbar, abgestimmt wird geheim. Das Host-Handy spielt mit (es kennt technisch alle Wörter, zeigt sie aber nicht) – oder ein
  **Laptop/Fernseher ist nur Bühne** und zeigt Reihenfolge, Timer, Abstimmung und Punkte groß. Optional werden Hinweise getippt.
- **Modi:** 🔤 *Wort* (Klassisch: Imposter weiß es, sieht auf Wunsch die Kategorie · *Undercover*: Imposter bekommt ein ähnliches
  Wort und merkt es nicht) und ❓ *Frage* (der Imposter bekommt eine andere Frage mit ähnlicher Antwort; nach den Antworten wird
  die Frage der Crew gezeigt).
- **Regeln:** Gleichstand → Stichwahl, wieder Gleichstand → niemand fliegt. 1–3 Imposter (höchstens ein Drittel, kennen sich nicht,
  werden einzeln gewertet), eine Abstimmung oder „bis zum Ende“. Die erste Person der Reihenfolge ist nie Imposter (abschaltbar),
  niemand zweimal hintereinander.
- **Punkte:** Imposter unentdeckt +3 · erwischt, aber Wort erraten +2 · erwischt und falsch geraten: jede Crew-Person +1 ·
  für einen Imposter gestimmt +1. Runden: so viele wie Personen, 3, 5 oder endlos – danach Siegerehrung mit Podest und
  Auszeichnungen (🎭 Meisterlügner:in, 🔍 Detektiv:in, 🙈 Verdächtig, 🧠 Gedankenleser:in).
- **🍻 Trinkregeln** (optional, auch alkoholfrei): erwischter Imposter trinkt 2, unentdeckter verteilt 3.

Die Wörter liegen in `imposter/js/words/woerter.js` (416 Wörter in 7 Kategorien + 48 ab 18, eine Zeile pro Wort:
`Kategorie|Wort|ähnliches Wort`), die Fragen in `imposter/js/words/fragen.js` (86 Paare + 18 ab 18: `Crew-Frage|Imposter-Frage`).
18+ ist standardmäßig aus.

## Prost!

Das Trinkspiel als Kartenstapel (ab 18): Eine Karte nach der anderen, mit den **Namen der Mitspielenden** eingesetzt –
*„Anna verteilt 3 Schlucke“*, *„Neue Regel: Niemand darf ‚ja‘ oder ‚nein‘ sagen“*, *„Ich hab noch nie …“*.
Gespielt wird mit **2–20 Personen**.

- **📲 Ein Gerät (Standard):** Handy, Tablet oder Laptop liegt in der Mitte. **Tippen, nach links wischen oder Leertaste/→** =
  nächste Karte, **◀ Zurück / nach rechts wischen / ←**, falls jemand zu schnell war. Bei „Wer würde eher“ gibt es einen
  Countdown 3 – 2 – 1, dann zeigen alle gleichzeitig. Läuft komplett offline.
- **📱 Mit Handys:** Das Kartengerät öffnet einen Raum (QR-Code). Die Handys lesen die Karte mit und stimmen **anonym** ab:
  bei „Wer würde eher“ zeigt das Kartengerät nur die Stimmen pro Person, bei „Ich hab noch nie“ nur die Anzahl
  (*„3 von 7 haben das schon mal gemacht – trinken jetzt auch wirklich alle 3?“*). Aufgelöst wird, sobald alle getippt haben
  (oder vorher per Knopf). Wer kein Handy hat, wird am Kartengerät eingetragen; ein Handy mit demselben Namen übernimmt die Person.
- **Kartentypen:** 🎯 Aufgabe · 🙋 Alle, die … · 🙅 Ich hab noch nie · 🗳️ Wer würde eher · ⚔️ Duell · 🔁 Kategorie ·
  🎲 Wahrheit oder trinken · 📜 Regel und 🦠 Virus (gelten, bis sie 5–15 Karten später aufgehoben werden – oder bis zum
  Spielende; aktive Regeln stehen oben unter 📜 und lassen sich von Hand aufheben) · 💧 Wasserpause (etwa alle 15 Karten
  3 Schlucke Wasser, abschaltbar).
- **Kartensets:** 🌱 Warm-up (kommt zuerst) · 🎉 Party · 🔥 Heftig · 💕 Pärchen (Paare werden beim Start oder im Spiel
  eingetragen, ohne Paare wird das Set übersprungen) · 🔞 18+ (eindeutig). Standard: Warm-up + Party.
- **Einstellungen:** Spieldauer 30 / 50 / 80 Karten oder endlos, Intensität leicht (×0,5) / normal / heftig (×1,5),
  Wasserpausen an/aus – alles auch mitten im Spiel (andere Sets mischen den Rest des Stapels neu).
- **Fair:** Namen werden erst beim Aufdecken eingesetzt – wer am seltensten dran war, kommt zuerst, niemand zweimal
  hintereinander. Personen können mitten im Spiel dazukommen oder gehen (ihre Regeln/Viren enden dann).
  Gespielte Karten merkt sich der Browser: beim nächsten Abend kommen erst die neuen.

Die Karten liegen in `prost/js/cards/` (494 Karten: Warm-up 63, Party 212, Heftig 84, Pärchen 48, 18+ 87), eine Zeile pro Karte:
`typ|text|ende-text` mit Platzhaltern `{p1}` `{p2}` `{p3}` (Namen), `{c1}` `{c2}` (Paar), `{s1}`…`{s5}` (Schlucke) und `{exen}`.
Bei `nie` und `eher` steht nur der Rest des Satzes, „Ich hab noch nie …“ bzw. „Wer würde eher …?“ ergänzt das Spiel.

---

## Pferderennen

Das Trinkspiel mit dem Kartendeck (ab 18, mit Chips auch alkoholfrei): Die **vier Asse sind die Pferde**, quer über der Bahn
liegen verdeckte Streckenkarten. Alle setzen auf ein Pferd, dann wird Karte für Karte aufgedeckt – die passende Farbe zieht
ein Feld vor. Wer auf den Sieger gesetzt hat, **verteilt**, alle anderen **trinken**. Gespielt wird mit **2–20 Personen**.

- **Drei Spielweisen:**
  - **🖥️ Ein Gerät:** Laptop, Fernseher oder Handy in der Mitte. Im **Wettbüro** für jede Person Pferd antippen und Einsatz −/+.
    Schnellknöpfe „🔁 Gleiche Wette wie letztes Rennen“ und „🎲 Rest zufällig“. Läuft komplett offline.
  - **📱 Mit Handys:** Der Laptop ist die Rennbahn und zeigt einen QR-Code. Jede Person setzt auf dem eigenen Handy (optional
    **🤫 geheim** – aufgedeckt wird beim Start), sieht während des Rennens das **eigene Pferd** mit Platzierung, Reihe und Chance
    (das Handy vibriert, wenn es vorzieht oder zurückfällt) und **verteilt** nach dem Sieg per Antippen (+1 pro Tippen, − nimmt
    zurück, nicht an sich selbst). Der Laptop zeigt live, wer wem wie viel gibt: *„Opa trinkt 9 (3 Einsatz + 6 von Ben)“*.
    Wer kein Handy hat, wird am Laptop eingetragen (Wetten dort, Verteilen über „Für … verteilen“); ein Handy mit demselben
    Namen übernimmt die Person. Neu laden / Verbindung weg → das Handy verbindet sich von selbst wieder als dieselbe Person.
    Wer beim Start noch nicht gesetzt hat, setzt nach Rückfrage aus.
  - **🃏 Echte Karten:** Ihr spielt mit einem echten Deck am Tisch, die App ist nur Wettbüro + Abrechnung: nach dem Rennen das
    Siegerpferd antippen (bei „Letzter doppelt“ / „Platz 2 frei“ auch Platz 2 und 3).
- **Rennen:** Fanfare, Countdown, Startschuss, dann automatisch (🐢 2,5 s / 🐎 1,5 s / ⚡ 0,8 s pro Karte, ⏸ Pause mit Leertaste
  oder `P`) oder **👆 per Tippen** (Leertaste / auf die Bahn tippen). Haben alle vier Pferde eine Reihe erreicht, wird deren
  Streckenkarte aufgedeckt und das Pferd dieser Farbe muss **ein Feld zurück** (nie hinter den Start). Wer zuerst über die letzte
  Reihe hinaus läuft, gewinnt. Ist der Stapel leer, werden die aufgedeckten Karten neu gemischt.
- **📈 Live-Chancen:** Neben jeder Bahn die aktuelle Siegchance mit ▲/▼. Dafür wird das restliche Rennen 2000-mal durchgespielt –
  mit den noch verdeckten Karten in zufälliger Lage (die Chance verrät also nichts über die echten Streckenkarten). Abschaltbar.
- **Stimmung:** Die Asse galoppieren im Takt, springen mit Staubwolke vor und wackeln, wenn sie zurück müssen; Karten drehen
  sich in 3D um, die Bahn glüht kurz vor dem Ziel. **Rennkommentar** zu jeder Karte (*„♠ Pik zieht davon!“*, *„Drama in Reihe 3 –
  ♥ Herz muss zurück! Ben leidet.“*). **Fotofinish** (Zweiter stand direkt vor dem Ziel): Blitz, Zielfoto in Schwarz-Weiß, dann
  der Sieger. Sounds per WebAudio: Fanfare, Startschuss, Hufgetrappel (im Menü abschaltbar), Raunen, Jubel.
- **Abrechnung (Schlucke):** Sieger verteilen **Einsatz × 2** (× 1 / × 3 einstellbar), die anderen trinken ihren Einsatz.
  Optional „Letzter trinkt doppelt“ und „Platz 2 trinkt nichts“. Platzierung bei Gleichstand: wer zuerst auf dem Feld war.
- **🪙 Chips-Modus (alkoholfrei):** Alle starten mit 20 Chips, gesetzt wird 1 bis alle eigenen (All-in-Knopf). Sieger bekommen
  den **Einsatz × 3** zurück, die anderen verlieren ihren Einsatz, wer pleite ist, bekommt pro Rennen 1 **Mitleidschip**.
  Optional **💸 Quoten-Wetten:** Nach der ersten Streckenkarte hält das Rennen an und jede Person darf einmal nachsetzen – zu
  Quoten aus den Live-Chancen (etwas unter fair). Am Ende **Siegerehrung** mit Podest. Die Währung ist nach dem ersten Rennen fest.
- **Statistik:** Rangliste (🎁 verteilt / 🍺 getrunken bzw. 🪙 Chips, 💰 gewonnen, 📉 verloren, 🎯 richtig getippt, 🎰 gesetzt),
  Auszeichnungen – 🎁 Wettkönig:in / 💰 Großverdiener:in, 🍺/📉 Pechvogel, 🎯 Glückspilz, 🎰 Zocker:in, 🐴 Treue Seele (ab 3 Rennen;
  nur wer heraussticht, höchstens 3 Namen) –, Pferde-Bilanz (Siege, Ø Platz, Fotofinishs) und Rennverlauf.
- **Mehrere Rennen:** 3 / 5 / 10 oder endlos. Im Menü: Mitspielende dazu/weg, Einstellungen, Handys verbinden, Rennen abbrechen,
  Rennabend beenden. **Einstellungen:** Deck 52 / 32 Karten (Skatblatt), Streckenlänge 5–8, Max. Einsatz 3 / 5 / 10, Tempo.
  Der Spielstand wird im Browser gespeichert (Neuladen → weiter, Rennen pausiert).

---

## Farbgefühl

Das Farben-Ratespiel nach *Hues and Cues*: Auf der **Farbtafel mit 480 Farbtönen** (30 Spalten × 16 Reihen, Felder A1–P30)
sieht eine Person geheim **4 Farben**, wählt eine und beschreibt sie mit **einem Wort** – *„Avocado“*, *„Flamingo“*. Alle anderen
setzen **reihum** einen Stein (ein Stein pro Feld), dann kommt ein **zweiter Hinweis** (ein oder zwei Wörter, darf auch
weggelassen werden) und ein zweiter Stein **gegen den Uhrzeigersinn**. Aufgedeckt wird mit einem **Rahmen**: genau 3 Punkte,
im 3 × 3-Rahmen 2, direkt am Rahmen 1 – die hinweisgebende Person bekommt **1 Punkt pro Stein im Rahmen**.
Gespielt wird mit **3–10 Personen** oder **2–4 Teams**.

- **🖥️ Ein Gerät:** Laptop oder Fernseher in der Mitte. Die geheime Karte erscheint hinter *„🙈 Alle wegschauen – nur Ben!“*,
  der Hinweis wird laut gesagt (oder eingetippt), gesetzt wird reihum per Klick: Feld anklicken = **Lupe**, nochmal klicken
  oder Enter = setzen, Pfeiltasten verschieben, ↩️ nimmt den letzten Stein zurück.
- **📱 Mit Handys:** Der Laptop zeigt die große Tafel und einen QR-Code. Karte und Hinweis kommen aufs Handy der
  hinweisgebenden Person (mit **Hinweis-Prüfung**: Grundfarben, hell/dunkel, Koordinaten, schon benutzt – nur als Warnung,
  „Trotzdem senden“ geht immer). Geraten wird auf dem Handy mit **7 × 7-Lupe** (quer halten = größere Tafel), die Steine
  erscheinen live auf dem Laptop. Wer kein Handy hat oder kurz offline ist, spielt am Laptop. Das erste Handy ist die
  **Spielleitung** und schaltet weiter. **⚡ Gleichzeitig** (statt reihum): alle setzen geheim, mehrere Steine pro Feld erlaubt.
- **Farbtafel:** berechnet im Farbraum OKLCH (wahrnehmungsgleich), Farbtöne so verteilt, dass Nachbarspalten gleich weit
  auseinanderliegen; oben pastell, Mitte kräftig, unten tief. Laptop und Handys rechnen exakt dieselben Werte.
  Koordinaten am Rand, in jedem Feld (hilft bei Farbsehschwäche) oder aus.
- **Spielende:** bis 6 Personen gibt jede Person 2× den Hinweis, ab 7 einmal (einstellbar 1–3× oder **bis 50 Punkte**);
  Gleichstand an der Spitze → **Stechen**. Siegerehrung mit Podest, Auszeichnungen (🎯 Adlerauge, 🗣️ Farbpoet:in,
  🌫️ Farbenblind, 💡 Bester Hinweis) und allen Farben des Abends.
- **Varianten:** ⚡ Schnell (ein Hinweis, ein Stein), 👥 Teams, 🙈 Blind (Hinweisgeber sieht die Tafel nicht),
  🎯 Freie Wahl (beliebiges Feld), ⏱ Zeit pro Stein (20/30/45 s), 🍻 Trinkregeln (daneben → 1 Schluck, Volltreffer → 2 verteilen).

---

## Schlecht erklärt

Das Film-Ratespiel mit **schlecht erklärten Filmen**: *„Ein Rentner weigert sich, ins Altersheim zu ziehen, und nimmt einfach
das ganze Haus mit.“* (→ *Oben*). Auf dem Laptop steht eine Beschreibung aus 1–3 Sätzen, technisch wahr, aber völlig
daneben – wer den Film erkennt, punktet. Gespielt wird mit **2–12 Personen** einzeln oder in **2–4 Teams** über 10–30 Filme,
mit **Stechen** bei Gleichstand.

- **💡 Hinweise:** Jahr & Genre → Tipp (z.B. ein Darsteller) → Titel-Lücken (*„D__ K____ d__ L____“*). Ein Treffer bringt
  **4 / 3 / 2 / 1** Punkte, je nachdem wie viele Hinweise offen waren. Mit Zeitlimit kommen sie automatisch nach je einem Viertel.
- **📱 Mit Handys:** Alle tippen den Titel – deutscher oder Originaltitel, Groß/klein, Artikel, Umlaute, Zahlen (*2 = II = zwei*)
  und kleine Tippfehler sind egal, *„knapp daneben“* kostet keinen Versuch. **3 Versuche** pro Team, **+1** für die Schnellsten,
  **Vorschläge** beim Tippen aus der ganzen Sammlung. Der Name der Reihe (*„Harry Potter“*) zählt, außer bei **🎯 Streng**.
  Erkennt die App eine richtige Antwort nicht, gibt es am Laptop **„zählt doch“**. Das erste Handy ist die **Spielleitung**.
- **🔘 Auswahl:** 4 Antworten zur Wahl (aus derselben Kategorie und ähnlicher Zeit), ein Versuch, 2 Punkte.
- **🗣️ Ein Gerät:** Alle rufen, Hinweise per Klick, nach dem Auflösen wird angetippt, wer es hatte.
- **✍️ Selbst erklären:** Reihum bekommt eine Person geheim einen Film aufs Handy (*„Kenn ich nicht“* bis zu 3×) und erklärt
  ihn selbst schlecht – die App warnt vor Wörtern aus dem Titel. Punkte gibt es für jedes andere Team, das ihn errät,
  aber 0, wenn es alle in den ersten 10 Sekunden wissen.
- **Inhalte:** **569 Filme** in 8 Kategorien (Animation & Familie, Action & Abenteuer, Komödie, Sci-Fi & Fantasy,
  Spannung & Horror, Drama & Liebe, Deutsche Filme, Klassiker) plus **53 Serien** als Extra, jeweils mit Schwierigkeit
  1–3. Eine Zeile pro Film in `schlecht-erklaert/js/filme/<kategorie>.js`:
  `Titel | weitere Antworten (~ = Reihe) | Jahr | Stufe | Beschreibung | Tipp`. Die Tests prüfen Länge (1–3 Sätze,
  max. 220 Zeichen), verräterische Titelwörter, Doppelte und Antworten, die auf zwei Filme passen würden.
- **👎 Melden:** Nach jeder Auflösung kann ein Film gemeldet werden (zu leicht, zu schwer, stimmt nicht, nicht lustig);
  die Liste lässt sich im Menü kopieren.
- **Spielende:** Siegerehrung mit Podest, Auszeichnungen (⚡ Blitzmerker, 🧠 Ohne Hilfe, 🙈 Filmriss, 📜 Erklärbär,
  🤯 Härtester Film) und alle Filme des Spiels.

---

## Nur einer

Unsere Version von **Just One**: Eine Person rät ein **geheimes Wort**, alle anderen schreiben **einen Hinweis** – aber
**doppelte Hinweise fliegen raus**. Wer *„Strand“* für *Sonne* schreibt, hofft, dass niemand sonst dieselbe Idee hatte.
**Kooperativ** mit **3–12 Personen** gegen den Kartenstapel: richtig = Karte gewonnen, falsch = diese **und die nächste**
Karte weg (bei der letzten Karte eine gewonnene), passen = nur diese. Am Ende zählen die gewonnenen Karten
(13 = 🏆 Perfekt! … 0–3 = Probiert's noch mal).

- **📱 Mit Handys (Standard):** Der Laptop ist die Bühne, die Handys sind die Hinweis-Tafeln. Das Wort steht auf allen Handys
  außer dem der ratenden Person (*„Kenn ich nicht“* zieht ein neues). Hinweise werden getippt (Zeitlimit 30/60 s oder aus),
  dann bestätigt die ratende Person **„🙈 Ich schaue weg“** und die Bühne zeigt alle Hinweise zur **Kontrolle**: Doppelte und
  Ungültige sind schon rot gestrichen, die Handys können **✋ Einspruch** einlegen, die Spielleitung tippt an = doch gültig /
  doch streichen. Erst danach sieht die ratende Person die übrigen Hinweise. Geraten wird **laut** (Spielleitung klickt
  richtig/falsch/passen) oder **getippt** (die App prüft, „zählt doch“ möglich). Das erste Handy ist die **Spielleitung**.
- **🖥️ Ein Gerät (Notfall):** Der Laptop zeigt das Wort, während die ratende Person wegschaut. Hinweise auf Zettel, Doppelte
  von Hand weg, dann laut raten und anklicken (falsch geklickt lässt sich korrigieren).
- **🔍 Doppel-Prüfung** (`nur-einer/js/clues.js` auf Basis von `shared/match.js`): gleich, Plural, Tippfehler (ab 5 Buchstaben)
  und gleicher Wortstamm (*heiß / heiße*) sind doppelt. Ungültig gegen das Lösungswort: das Wort selbst, enthält es oder steckt
  darin (*Sonnenbrille*, *Brille* für *Sonnenbrille*), Wortfamilie (*sonnig*), Übersetzung aus einer kleinen Liste (*Sun*),
  mehr als ein Wort. Synonyme (*Auto / Wagen*) sind **nicht** doppelt. Lieber etwas zu streng – die Runde korrigiert per Einspruch.
- **Varianten:** 13 / 20 Karten oder **endlos** (bis 3× falsch) · **zu dritt** schreibt jede/r 2 Hinweise · **große Runde**
  (ab 8): pro Karte schreibt abwechselnd nur die Hälfte · **🏁 Wettkampf**: 2 Teams mit eigenem Stapel, abwechselnd ·
  **✍️ Eigenes Wort**: die Spielleitung tippt statt der Karte ein Wort ein · Schwierigkeit leicht / gemischt / schwer.
- **Wörter:** fast 1000 in 3 Stufen – die eigene Liste `nur-einer/js/woerter.js` (Wörter mit vielen Assoziationen) plus die
  Begriffe aus Guess the word! (Erklären) und Imposter. `nur-einer/js/words.js` liest alle Quellen ein und entfernt Doppelte;
  gespielte Wörter merkt sich das Gerät.
- **Spielende:** Wertung, **🏆 Bestenliste** pro Gerät und Auszeichnungen (🦄 Einzigartig, 👯 Seelenverwandte, 🎯 Bester Hinweis,
  🙈 Gleiche Wellenlänge, 🧠 Ratefuchs) sowie alle Wörter mit ihren Hinweisen.

---

## Wavelength

Unsere Version von **Wavelength**: Auf dem Laptop liegt eine **Skala** zwischen zwei Gegensätzen, z. B. *kalt ↔ heiß*. Nur eine
Person sieht, wo auf dem Halbkreis das **Ziel** liegt, und sagt **einen Hinweis** – *„Kaffee“*. Ihr Team dreht den **Zeiger**
dorthin, dann klappt die Abdeckung wie ein Fächer auf: Mitte **4**, daneben **3**, außen **2** Punkte. Gespielt wird mit
**2 Teams** (4–12 Personen) oder **kooperativ** (2–12).

- **Regeln:** Die hinweisgebende Person darf einmal pro Zug eine andere Skala ziehen und beim Drehen nicht helfen. Steht der Zeiger,
  tippt das **Gegnerteam**, ob das Ziel **links oder rechts** davon liegt (richtig = 1 Punkt, genau auf der Mitte zählt nicht).
  Erstes Team mit **10 Punkten** gewinnt (Team 2 startet mit 1 Punkt als Ausgleich); kommen beide im selben Zug ans Ziel, gewinnt
  das Team mit mehr Punkten, bei Gleichstand gibt es ein **Stechen** (nach jeder vollen Runde gewinnt, wer vorne liegt).
  **Aufholregel:** Wer eine 4 holt und trotzdem hinten liegt, ist gleich nochmal dran.
- **📱 Mit Handys (Standard):** Das Ziel steht nur auf dem Handy der hinweisgebenden Person (dort kann der Hinweis auch eingetippt
  werden – mit Warnung bei Zahlen und Wörtern der Skala). Alle im Team sehen den Zeiger auf dem Handy und dürfen ihn ziehen, der
  Laptop zeigt ihn live (höchstens 10 Nachrichten pro Sekunde). **„Fertig“** braucht 2 Personen (oder die Spielleitung), wer danach
  noch dreht, setzt die Zustimmung zurück. Das Gegnerteam stimmt per Handy ab, die Mehrheit zählt (Gleichstand: rechts).
  Das erste Handy ist die **Spielleitung** (Zeiger festlegen, Abstimmung auswerten, weiter).
- **🖥️ Ein Gerät:** *„Alle wegschauen – nur Anna!“* → Ziel zeigen → Hinweis sagen (optional eintippen) → verdecken. Danach ist das
  Ziel nicht mehr abrufbar. Zeiger mit Maus, Finger oder **← →** (Umschalt = 5°), Links/Rechts per Klick.
- **🤝 Kooperativ:** alle zusammen, 7 Skalen, kein Links/Rechts-Tipp, jede 4 bringt eine Skala extra. Wertung: 0–7 Funkloch ·
  8–13 Rauschen · 14–18 Guter Empfang · 19–23 Gleiche Welle · 24+ Gedankenleser.
- **Einstellungen:** Ziel 10 / 15 Punkte, Zielbreite breit (Kinder, 9° pro Streifen) / normal (7°) / schmal (Profis, 5°),
  Links/Rechts-Tipp und Aufholregel an/aus, Kategorien, Zeit fürs Team (aus / 60 / 90 / 120 s), **✍️ Eigene Skala**
  (die hinweisgebende Person tippt selbst ein Paar ein), **🍻 Trinkregeln** (0 Punkte → Team trinkt 1, 4 Punkte → 2 verteilen).
- **Skalen:** 415 eigene Paare in `wavelength/js/skalen/` – Klassisch (112), Meinung (100), Kultur (72), Schräg (81) und
  Ab 18 (50, standardmäßig aus). Eine Zeile pro Paar: `links | rechts | Stufe`. Etwa jede dritte Skala wird umgedreht,
  gezogene Skalen merkt sich das Gerät. `npm test` prüft Anzahl, Länge (beide Enden max. 40 Zeichen) und Doppelte – auch umgedreht.
- **Spielende:** Siegerehrung bzw. Wertung, Auszeichnungen (🎯 Volltreffer, 📻 Gleiche Welle, 🌀 Funkloch, 🧭 Richtungsgefühl)
  und alle Skalen des Spiels mit Hinweis und Abweichung.

---

## Skribbl

Zeichnen und raten: Reihum **zeichnet** eine Person einen Begriff auf dem **Handy**, die Zeichnung erscheint **live auf dem
Laptop**, alle anderen **tippen** ihre Tipps ins Handy – so oft sie wollen. Wer schneller richtig liegt, bekommt mehr Punkte.
**3–12 Personen**, 1–3 Runden (in jeder Runde zeichnet jede/r einmal), Laptop + Handys.

- **Ablauf eines Zuges:** Die zeichnende Person wählt aus **3 Begriffen** (leicht / mittel / schwer, 10 s – sonst entscheidet
  der Zufall) und zeichnet (60 / 80 / 100 / 120 s). Werkzeuge: 12 Farben, 3 Stärken, **🪣 Farbeimer** (Flood-Fill), Radierer,
  Rückgängig, Löschen. Der Zug endet, wenn alle es haben oder die Zeit um ist; danach 8 s Auflösung mit Wort und Punkten.
- **Raten:** **Richtig** (auch mit Artikel, Plural wie *die Kühe* für *Kuh*, Groß/klein, *ae* statt *ä*, Mehrwort-Begriffe ohne
  Leerzeichen) → ✅, man sieht ab jetzt das Wort, die Bühne zeigt nur *„Anna hat es!“*. **Knapp daneben** (ein Tippfehler, ab
  9 Buchstaben zwei) erfährt nur die tippende Person. **Falsche** Tipps laufen im Chat über die Bühne. Wer es schon hat, kann
  weiterschreiben – das lesen nur die, die es auch haben (und die zeichnende Person).
- **Hinweise:** Das Wort steht als Lücken mit Buchstabenzahl da (*„_ _ _ _ _ _ _  7“*), Leerzeichen und Bindestriche sind
  sichtbar. Nach 50 % und 75 % der Zeit wird je ein Buchstabe aufgedeckt (nie zwei nebeneinander, kurze Wörter nur einer).
- **Punkte:** Ratende **Rest-Zeit-Anteil × 100 + 50**, wer zuerst richtig liegt **+50**. Die zeichnende Person bekommt den
  **Durchschnitt der Ratenden-Punkte × Anteil der Treffer** – erkennt es niemand, gibt es 0.
- **🚩 Melden:** Ratende (die es noch nicht haben) melden Buchstaben oder Unpassendes. Bei Mehrheit wird der Zug abgebrochen,
  die zeichnende Person bekommt 0.
- **Live-Übertragung:** Die Striche laufen nicht über die Ansicht, sondern als eigene, kleine Nachrichten (alle ~45 ms die neuen
  Punkte) Handy → Laptop → alle Handys (Live-Vorschau). Der Laptop prüft jede Nachricht (nur die zeichnende Person, nur der
  laufende Zug) und schickt Geräten, die (wieder) dazukommen, die bisherige Zeichnung. Neu laden geht auf beiden Seiten.
- **Einstellungen:** Runden, Zeichenzeit, Wortwahl (3 zur Auswahl / zufällig), Hinweis-Buchstaben (0 / 1 / 2),
  **Zeichnen auf** Handy oder **Laptop** (Maus/Touchscreen, das Wort steht dann auf dem Handy der zeichnenden Person),
  Chat am Laptop an/aus, **🍻 Trinkregeln** (niemand errät es → zeichnende Person 2, wer es als Letzte/r errät → 1;
  alkoholfrei mit Strafpunkten).
- **Begriffe:** *Standard* sind die Zeichnen-Begriffe aus Guess the word! (ohne lange Sprichwörter), dazu 7 Pakete in
  `skribbl/js/woerter/` – Tiere, Essen, Berufe, Filme & Serien, Gegenstände, Orte, Aktionen (je rund 115, Stufe 1–3).
  **Eigene Wörter** lassen sich in der Lobby eintippen (gemischt oder *nur eigene*); sie gehen nie an die Handys.
  Gezeichnete Begriffe merkt sich das Gerät.
- **Spielende:** Siegerehrung mit Podest, Auszeichnungen (🎨 Picasso, ⚡ Adlerauge, 🔍 Spürnase, 🙈 Rätselhaft – die Zeichnung,
  die niemand erkannt hat, ist in der Galerie markiert) und die **🖼️ Galerie** aller Zeichnungen am Laptop.

---

## Flüsterpost

Stille Post mit Zeichnungen: Alle **schreiben** gleichzeitig einen Satz, der Satz wandert weiter und wird **gezeichnet**, die
Zeichnung wandert weiter und wird **beschrieben** – und so fort. Am Ende zeigt der Laptop jede **Kette** von vorne bis hinten:
aus *„Ein Pinguin fährt Ski“* wird über ein paar Stationen *„Oma bügelt einen Fisch“*. **3–12 Personen**, Laptop + Handys.

- **Weitergabe:** Im Schritt *k* bearbeitet Person *i* die Kette von Person *(i − k) mod n* – niemand sieht die eigene Kette
  wieder, bevor sie fertig ist, und bei „Schritte: alle“ kommt jede Kette bei allen genau einmal vorbei. Man sieht immer nur
  den Schritt direkt davor. Wer später kommt, schaut nur zu (die Ketten stehen fest).
- **Ablauf eines Schritts:** Alle gleichzeitig, mit Zeitlimit (Schreiben 30 / 45 / 60 s, Zeichnen 60 / 90 / 120 s oder ohne).
  Wer fertig ist, tippt *Fertig* (und kann es noch ändern); sind alle fertig, geht es sofort weiter. Läuft die Zeit ab, gibt
  das Handy selbst ab, was da ist. Alle paar Sekunden geht ein Zwischenstand an den Laptop – fällt ein Handy aus, zählt der,
  sonst steht *„(verschollen)“* in der Kette. Am Laptop: *⏩ Beeilung!* (noch 10 s), nochmal gedrückt: sofort abgeben.
- **Zeichnen:** 12 Farben, 3 Stärken, 🪣 Farbeimer, Radierer, Rückgängig, Löschen. Die Striche werden mit **Zeitstempel**
  gespeichert, beim *Fertig* verdichtet (Rückgängig/Löschen angewendet, Punkte auf ~2 px ausgedünnt, höchstens ~60 KB) und erst
  dann an den Laptop geschickt. Der Laptop schickt jedem Handy genau die eine Zeichnung, die es für seinen Schritt braucht.
- **🎬 Vorführung:** Kette für Kette, Schritt für Schritt. Zeichnungen entstehen **Strich für Strich** noch einmal (doppelt so
  schnell, Denkpausen gekürzt, 1,5–9 s; Einstellung „sofort fertig“ möglich). Weiterschalten kann der Laptop (auch mit → /
  Leertaste) und wem die Kette gehört (am Handy). Am Ende jeder Kette: **✅ Angekommen** oder **🔀 Völlig anders** – verglichen
  werden die Inhaltswörter von Anfang und letzter Beschreibung (Plural, Artikel, Tippfehler egal); der Laptop kann es korrigieren.
- **❤️ Lieblingsmoment:** Auf den Handys verteilt jede/r pro Kette ein Herz (nicht für Eigenes). Am Ende: *Lieblingsmoment
  des Abends*, *Herzensbrecher/in*, wie viele Ketten heil angekommen sind, und alle Ketten als **Galerie** – jede auch als
  lange Grafik **💾 zum Speichern** (nur am Laptop, wird lokal erzeugt).
- **Modi:** *Normal* (Satz → Zeichnung → Beschreibung → …), *Wort-Start* (jede Kette beginnt mit einem Begriff aus Guess the
  word!, erst wird gezeichnet, 🎲 anderes Wort), *Nur Zeichnen* (Zeichnung nur **3 Sekunden** ansehen, dann aus dem Gedächtnis
  nachzeichnen; am Ende wird beschrieben).
- **Startsätze:** Wer keine Idee hat, tippt auf **🎲 Vorschlag** – aus *Familie* (126 Sätze), *Ab 18* (77) oder **eigenen**
  Sätzen der Runde (gehen nicht an alle Handys, nur der jeweilige Vorschlag).
- **Weitere Einstellungen:** Schritte (alle / 4 / 6 / 8), **🍻 Trinkregeln** (Kette kommt völlig anders an → die Startperson
  trinkt 1; alkoholfrei mit Strafpunkten).
- **Neu laden** geht auf beiden Seiten: Das Handy hält die laufende Arbeit im Tab, der Laptop speichert den Spielstand und die
  Zeichnungen getrennt (eigener Schlüssel, gebremst).

---

## Stadt, Land, Fluss

Der Klassiker: Ein **Buchstabe** wird gezogen, alle füllen ihre **Kategorien** aus (*Stadt, Land, Fluss, Name, Tier, Beruf …*).
Wer alles ausgefüllt hat, ruft **„Stopp!“** – dann haben alle noch **3 Sekunden**. **2–12 Personen** (Teams: ein Handy bzw.
ein Zettel pro Team), 5 / 8 / 10 Runden, danach Siegerehrung.

- **📱 Mit Handys (Standard):** Der Laptop ist die Bühne (Buchstabe, Uhr, Füllstand ▰▰▱ pro Person), geschrieben wird auf den
  Handys – eine Zeile pro Kategorie, ein falscher Anfangsbuchstabe wird sofort rot. Antworten gehen gedrosselt und laufend an
  den Laptop (wer die Verbindung verliert, verliert nichts); während des Schreibens sieht niemand fremde Antworten, die Bühne
  nur den Füllstand. **Stopp** gibt es erst, wenn alles ausgefüllt ist (die letzten Eingaben kommen mit).
- **👎 Abstimmung**, Kategorie für Kategorie: Die App fasst gleiche Antworten zusammen (`shared/match.js`: Groß/klein, kleine
  Tippfehler, Plural, Artikel – *„Die Mosel“ = „Mosel“*, *„St.“ = „Sankt“*) und prüft nur den Anfangsbuchstaben. Inhaltlich
  entscheidet die Gruppe: **Mehrheit 👎** (der anderen) = zählt nicht, bei **Gleichstand** entscheidet die Spielleitung
  (sonst zählt die Antwort). *Nur angezweifelte* (Standard: 👎 oder „Alles ok“) oder *alle Antworten* (👍/👎 für jede).
  Die Spielleitung (Laptop oder erstes Handy) kann jede Antwort streichen oder doch zählen lassen – nur nicht die eigene am Handy.
- **✓ bekannt:** Kleine Hilfslisten (`stadt-land-fluss/js/listen/`: ~450 Städte, alle Länder, ~200 Flüsse, ~280 Tiere,
  ~360 Vornamen) zeigen bei der Abstimmung ein ✓ – nur eine Hilfe, nie ein Urteil.
- **Anfangsbuchstabe:** Ä/Ö/Ü zählen für A/O/U (abschaltbar), Akzente sind egal. Ein Artikel davor ist erlaubt: *„Die Mosel“*
  zählt bei M (und wegen *Den Haag* auch bei D). *„St. Petersburg“* beginnt mit S. Jeder Buchstabe nur einmal pro Spiel,
  ohne Q, X, Y (abschaltbar). **🔤 ABC im Kopf:** Das Alphabet läuft auf der Bühne, bis jemand Stopp drückt.
- **Punkte:** einzige Person mit einer gültigen Antwort **20**, einzigartig **10**, doppelt **5**, leer/ungültig **0**
  (einfach: 10 / 5). Wird eine Antwort weggestimmt, kann die übrige zur *einzigen gültigen* werden.
- **Rundenende:** Stopp (+3 s), feste Zeit (60 / 90 / 120 / 180 s) oder beides (Standard: Stopp, spätestens nach 120 s).
- **📋 Kategorien:** Standard, eigene **Auswahl** (3–12) aus den Paketen 🏠 Klassisch, 🎬 Popkultur, 🍔 Essen, 🤪 Lustig,
  🔥 Ab 18 (Standard aus) plus **eigene Kategorien** (im Browser gespeichert), oder **🎲 Zufall**: jede Runde 6 andere aus den
  gewählten Paketen (`stadt-land-fluss/js/kategorien.js`).
- **🖥️ Ein Gerät:** Geschrieben wird auf Papier. Der Laptop zieht den Buchstaben, läuft als Uhr mit (großer STOPP-Knopf) und ist
  der **Punkteblock**: pro Person und Kategorie 0 / 5 / 10 / 20 antippen.
- **🍻 Trinkregeln** (Standard aus): 0 Punkte in einer Kategorie → 1 Schluck, Stopp gerufen und trotzdem ein Fehler → 2 dazu.
- **Spielende:** Podest und Auszeichnungen (⚡ Schnellste Finger, 🦄 Kreativ, 🤝 Mainstream, 🤨 Erwischt, 🙃 Netter Versuch –
  die weggestimmte Antwort mit den meisten 👎) sowie alle Runden zum Nachlesen.

---

## Who knows more?

Das Quiz mit der **Fragenwand**: Kategorien nebeneinander, darunter Felder mit 100–500 Punkten. Das Team am Zug wählt ein Feld,
nach dem Vorlesen ist der **Buzzer frei** – wer zuerst buzzert, antwortet laut: richtig = +Wert (und wählt weiter), falsch = −Wert,
dann dürfen die anderen. Der **Laptop** (oder Fernseher) ist die Wand, gespielt wird mit **1–4 Teams**.

- **Runden:** Runde 1 (100–500) → Runde 2 mit doppelten Werten (das Team mit den wenigsten Punkten beginnt) → **Finale**:
  erst die Kategorie, jedes Team mit Punkten setzt geheim (0 bis Punktestand), dann 30 Sekunden für die Antwort, aufgedeckt
  wird vom letzten zum ersten Platz. „Kurz“ = 1 Runde + Finale.
- **🎲 Joker-Felder:** versteckt (Runde 1: eins, Runde 2: zwei, nie in der obersten Reihe). Nur das wählende Team antwortet und
  setzt vorher 5 bis Punktestand – mindestens bis zum höchsten Feldwert der Runde.
- **🗣️ Ohne Handy:** Buzzer-Tasten am Laptop – 🔴 `A` · 🔵 `F` · 🟢 `J` · 🟡 `L` (oder Team unten anklicken), `Leertaste` =
  Buzzer frei / Antwort zeigen / weiter, `R` / `X` = richtig / falsch. Finale-Einsätze und -Antworten auf Zettel, am Laptop eintragen.
- **📱 Mit Handy:** QR-Code scannen, Team wählen – das Handy ist ein großer Buzzer. Fair übers Netz: Jedes Handy misst selbst die
  Reaktionszeit nach „Buzzer frei“, der Laptop wartet nach dem ersten Buzz 250 ms und nimmt die kleinste. Wer zu früh drückt, ist
  0,5 s gesperrt. Das Team am Zug wählt das Feld auf dem Handy (Mini-Wand), Joker-/Finale-Einsätze und Finalantworten sind geheim.
- **🎤 Quizmaster (optional):** Eine Person sieht auf dem Handy Frage und Antwort, gibt den Buzzer frei und entscheidet ✓ / ✗ –
  auch ohne Buzzer-Handys (dann verbindet sich nur das Quizmaster-Handy). Ohne Handy hält er auf dem Laptop „Antwort ansehen“ gedrückt.
  Ohne Quizmaster wird nach der Antwort aufgedeckt und die Runde entscheidet; im Finale schlägt `match.js` vor, ob es passt.
- **Einstellungen:** 4/5/6 Kategorien, Joker an/aus, Minuspunkte an/aus (Joker & Finale bleiben ±Einsatz), Antwortzeit 5/10/15 s,
  **Umgekehrt** (die Wand zeigt die Antwort, gesucht ist die Frage), **18+** (1–2 Kategorien ab 18 pro Runde, standardmäßig aus).
  Im Menü: Punkte korrigieren, Frage überspringen, Runde beenden. Am Ende Siegerehrung mit Auszeichnungen
  (⚡ Schnellster Buzzer, 🎯 Treffsicher, 🎲 Zocker, 🙈 Voreilig).
- **✏️ Eigene Wände:** Editor mit 1–2 Runden, 1–6 Kategorien, Joker-Markierung, Bild-URLs und eigener Finalfrage. Gespeichert im
  Browser, Export/Import als `.json`, **Teilen per Link** (`who-knows-more/#wand=…` – die Wand steckt komprimiert im Link, mit QR-Code).
  Gespielt wird „nur eigene Wand“ oder „gemischt“ (fehlende Kategorien/Runden aus dem Katalog).

Der Katalog liegt in `who-knows-more/js/questions/` – eine Datei pro Gruppe (`wissen.js`, `pop.js`, `gaming.js`, `alltag.js`,
`schule.js`, `wort.js`, 18+ in `adult.js`, Finalfragen in `katalog.js`): 44 Kategorien mit je **50 Fragen** (2.200 Fragen,
je 10 pro Feldwert – Stufe 5 ist richtig schwer) + 31 Finalfragen, dazu 6 Kategorien ab 18 (300 Fragen) + 6 Finalfragen.
Format: `'Stufe|Frage|Antwort'` (Stufe 1–5 = 100–500), mehrere richtige Antworten mit ` / ` trennen.
Pro Spiel kommt je Stufe eine Frage auf die Wand; der Browser merkt sich gespielte Kategorien und Fragen, sodass sich
Fragen erst wiederholen, wenn alle 10 einer Stufe dran waren.

---

## Guess the word! – Erklären, Zeichnen, Pantomime

Das Partyspiel **Guess the word!** (früher „Activity“) als Website – im **Offline-Modus** auf einem Gerät, das herumgereicht wird,
oder im **Online-Modus**, bei dem jede Person auf dem eigenen Handy mitspielt.

## Features

- **Spielbrett** als Rundkurs mit zufällig verteilten Feldern der 3 Kategorien
  💬 Erklären · ✏️ Zeichnen · 🎭 Pantomime (Startfeld: Kategorie frei wählbar)
- **3 animierte Kartenstapel**: Leicht (3 Punkte), Mittel (4 Punkte), Schwer (5 Punkte) –
  die Karte fliegt vom Stapel in die Mitte und dreht sich um
- **999 Begriffe**: 333 pro Kategorie (je 111 leicht / mittel / schwer)
- **Erklären-Karten** haben immer **3 verbotene Wörter**
- **18+-Modus** (optional): 200 zusätzliche Begriffe, gleichmäßig verteilt (67 / 67 / 66)
- **Bis zu 4 Teams** in Rot, Blau, Grün und Gelb – mit Teamnamen und Spielernamen
- **Reihum erklären**: In jedem Team ist bei jedem Zug eine andere Person dran
- Timer (30–120 s) mit Ticken in den letzten Sekunden, Pause, Sounds, Konfetti, Siegerehrung
- **Zeichenfläche** auf dem Bildschirm (online live für alle sichtbar)
- **Handy als Kartenhand** im Offline-Spiel: Laptop/Tablet zeigt das Spielbrett, per QR-Code wird ein Handy
  verbunden, das die Kartenstapel, die Person am Zug und die Kategorie zeigt
- **Online**: Raum-Code, Einladungslink und QR-Code, Lobby mit Teamwahl, Karte nur für die Person sichtbar,
  die dran ist, Tipps können eingetippt werden (werden automatisch erkannt), Wiederverbinden nach Neuladen
- Spielstand wird automatisch gespeichert, funktioniert als App (PWA) auch ohne Internet
- Für Handy, Tablet und Desktop optimiert

## Spielen

### Offline (ein Gerät)

1. **Offline spielen** → Teams aktivieren, Team- und Spielernamen eintragen, Einstellungen wählen
2. Das Team am Zug wählt einen Kartenstapel (die Kategorie steht auf dem Feld der eigenen Spielfigur)
3. Gerät an die Person geben, die dran ist → **Karte aufdecken** → **Zeit starten**
4. Erraten? **✓ Erraten!** – die Figur zieht so viele Felder vor, wie die Karte Punkte bringt

### Offline mit Laptop als Spielbrett + Handy als Kartenhand

1. Am Laptop (oder Tablet/Fernseher) ein Offline-Spiel anlegen und **📱 Handy als Kartenhand** einschalten
   (oder später oben auf **📱 Handy verbinden** tippen)
2. Den angezeigten **QR-Code** mit dem Handy scannen
3. Das Handy zeigt, **wer dran ist** und **welche Kategorie** gilt, dazu die **3 Kartenstapel**.
   Das Handy wird immer an die Person weitergegeben, die dran ist – nur sie sieht die Karte
4. Der Laptop zeigt Spielbrett, Timer und nur die Rückseite der Karte. Beim Zeichnen kann auf dem Handy
   gezeichnet werden, das Bild erscheint live auf dem Laptop
5. Nach dem Zug auf dem Handy **Weiter** tippen und es der nächsten Person geben

Das Handy braucht dafür eine Internetverbindung (gleicher Verbindungsweg wie der Online-Modus, siehe unten).
Verliert es kurz die Verbindung oder wird eine Seite neu geladen, verbinden sich beide Geräte automatisch wieder.

### Online (jeder mit eigenem Gerät)

1. Eine Person tippt auf **Online spielen → Raum erstellen**
2. Die anderen öffnen den Einladungslink / QR-Code oder geben den **Raum-Code** ein
3. In der Lobby wählt jede Person ihr Team, der Host startet das Spiel
4. Die Karte sieht nur, wer dran ist. Beim Zeichnen sehen alle die Zeichnung live,
   das eigene Team kann Tipps eintippen. (Für Pantomime/Erklären aus der Ferne einfach zusätzlich einen Videocall nutzen.)

## Website bereitstellen

Die Seite besteht nur aus statischen Dateien (kein Build-Schritt nötig).

### Variante A: GitHub Pages (kostenlos, ohne eigenen Server)

1. Im Repository auf GitHub: **Settings → Pages**
2. Bei *Source* „Deploy from a branch“ wählen, Branch **main** und Ordner **/ (root)** → *Save*
3. Nach ca. einer Minute ist die Seite unter `https://tbnsuperkid.github.io/` erreichbar,
   Guess the word! unter `https://tbnsuperkid.github.io/guess-the-word/`

Der Online-Modus nutzt dabei direkte Verbindungen zwischen den Geräten (WebRTC über
[PeerJS](https://peerjs.com/)). Das klappt in den allermeisten Netzwerken; in sehr strikten
Firmen- oder Mobilfunknetzen kann eine Verbindung scheitern – dann hilft Variante B.

### Variante B: Eigener Node-Server (zuverlässigster Online-Modus)

```bash
npm install
npm start          # http://localhost:3000  (Port über PORT=… änderbar), Guess the word! unter /guess-the-word/
```

Der Server liefert die Website aus und vermittelt den Online-Modus per WebSocket. Er lässt sich
auf jedem Node-Hoster (z. B. Render, Railway, Fly.io) betreiben: Start-Befehl `npm start`.

### Nur offline spielen

`guess-the-word/index.html` einfach im Browser öffnen – fertig.

## Begriffe anpassen

Die Begriffe liegen in `guess-the-word/js/words/`:

| Datei          | Inhalt                                          | Format pro Zeile                       |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `erklaeren.js` | 333 Begriffe (111 je Schwierigkeit)             | `Begriff\|Tabu 1\|Tabu 2\|Tabu 3`      |
| `zeichnen.js`  | 333 Begriffe                                    | `Begriff`                              |
| `pantomime.js` | 333 Begriffe                                    | `Begriff`                              |
| `adult.js`     | 200 Begriffe ab 18 (67 / 67 / 66), in alle Stapel gemischt | `Begriff\|Tabu 1\|Tabu 2\|Tabu 3` |

`npm test` prüft Anzahl, Tabuwörter und doppelte Begriffe sowie die Spiellogik aller Spiele.

## Projektstruktur

```
index.html                     Spieleauswahl (Startseite)
hub.css                        Design der Spieleauswahl
sw.js                          Service Worker der Startseite
vendor/                        gemeinsame Bibliotheken & Schriften (siehe vendor/LICENSES.md)
shared/net.js                  Netzwerk für alle Spiele: WebSocket-Relay oder PeerJS
shared/room.js                 Handy-Verbindung: Raum, Beitreten, Ping, Wiederverbinden, QR-Code, Controller
shared/fx.js                   Sounds & Konfetti
shared/match.js                Wörter vergleichen (Plural, Tippfehler, Artikel …) – 2 Dumme, Geheimsache, Imposter
shared/sketch.js               Zeichenfläche (normierte Striche, Farbeimer, Live-Übertragung) – Guess the word!, Skribbl, Flüsterpost
shared/fill.js                 Farbeimer (Flood-Fill) für die Zeichenfläche – Skribbl, Flüsterpost
shared/config.js               Transport-Wahl (der Node-Server liefert hier „ws“ aus)
server/server.js               optionaler Node-Server (statische Dateien + WebSocket-Relay)
tests/                         Tests (npm test)

guess-the-word/index.html      Guess the word!: Einstieg
guess-the-word/css/style.css   Design
guess-the-word/js/app.js       Oberfläche (Bildschirme, Brett, Stapel, Karten, Timer)
guess-the-word/js/engine.js    Spielregeln & Spielzustand
guess-the-word/js/deck.js      Kartenstapel (Ziehen ohne Wiederholungen)
guess-the-word/js/controllers.js Offline (+ Handy-Kartenhand) / Online-Host / Online-Mitspieler
guess-the-word/js/words/       Begriffslisten
guess-the-word/sw.js           Service Worker (Offline-Fähigkeit)
activity/                      Weiterleitung alter Links & QR-Codes nach guess-the-word/

zwei-dumme/index.html          2 Dumme, 1 Gedanke: Einstieg
zwei-dumme/css/style.css       Design
zwei-dumme/js/app.js           Oberfläche (Laptop-Bühne und Handy-Ansicht)
zwei-dumme/js/engine.js        Spielregeln: beide Modi, Punkte, Stechen, Zeitlimits, Auszeichnungen
zwei-dumme/js/deck.js          Begriffe ziehen ohne Wiederholung
zwei-dumme/js/controllers.js   Laptop (Host) / Handy (Mitspieler)
zwei-dumme/js/words/           Begriffsliste
zwei-dumme/sw.js               Service Worker (Offline-Fähigkeit)

pi-mal-daumen/index.html       Pi mal Daumen: Einstieg
pi-mal-daumen/css/style.css    Design
pi-mal-daumen/js/app.js        Oberfläche (Laptop-Bühne mit Zahlenstrahl, Handy-Ansicht)
pi-mal-daumen/js/engine.js     Spielregeln: Wertung, Reihum, gemeinsames Feld/Median, Joker, Stechen
pi-mal-daumen/js/numbers.js    Zahlen einlesen („1,5 Mio“) und anzeigen
pi-mal-daumen/js/deck.js       Fragen ziehen ohne Wiederholung
pi-mal-daumen/js/controllers.js Laptop (Host) / Handy (Mitspieler)
pi-mal-daumen/js/fragen/       Fragen je Kategorie
pi-mal-daumen/sw.js            Service Worker (Offline-Fähigkeit)

geheimsache/index.html         Geheimsache: Einstieg
geheimsache/css/style.css      Design
geheimsache/js/app.js          Oberfläche (Laptop-Spielfeld, Schlüsselkarte #k=…, Handy-Ansichten)
geheimsache/js/engine.js       Spielregeln: Züge, Hinweise, Sanduhr, Partien, Chef-Wechsel, Trinkregeln, Auszeichnungen
geheimsache/js/board.js        Feld austeilen, Schlüssel ↔ Link-Code, Hinweis prüfen
geheimsache/js/controllers.js  Laptop (Host) / Handy (Mitspieler)
geheimsache/js/words/          Wörterlisten (normal, 18+)
geheimsache/sw.js              Service Worker (Offline-Fähigkeit, auch für die Schlüsselkarte)

imposter/index.html            Imposter: Einstieg
imposter/css/style.css         Design
imposter/js/app.js             Oberfläche (Ein Gerät, Handy, Laptop-Bühne)
imposter/js/engine.js          Spielregeln: Rollen, Hinweise, Abstimmung, Stichwahl, Wort raten, Punkte, Trinkregeln, Auszeichnungen
imposter/js/deck.js            Wörter/Fragen ziehen ohne Wiederholung, Wort-Raten prüfen
imposter/js/controllers.js     Host (Gerät/Handy/Laptop) / Handy (Mitspieler)
imposter/js/words/             Wörter mit ähnlichem Wort, Fragen-Paare
imposter/sw.js                 Service Worker (Offline-Fähigkeit)

prost/index.html               Prost!: Einstieg
prost/css/style.css            Design
prost/js/app.js                Oberfläche (Kartengerät mit Tippen/Wischen, Handy-Abstimmung)
prost/js/engine.js             Spielablauf: Regel-Enden, Wasserpausen, Zurück, Personen/Paare, anonyme Abstimmungen
prost/js/deck.js               Kartenlisten einlesen, Stapel bauen (Warm-up zuerst, Gesehenes zuletzt), Platzhalter füllen
prost/js/controllers.js        Kartengerät (Host) / Handy
prost/js/cards/                Kartensets (Warm-up, Party, Heftig, Pärchen, 18+)
prost/sw.js                    Service Worker (Offline-Fähigkeit)

pferderennen/index.html        Pferderennen: Einstieg
pferderennen/css/style.css     Design (Rennbahn, Spielkarten in CSS)
pferderennen/js/app.js         Oberfläche (Rennbahn mit Galopp/Kartenwenden/Fotofinish, Lobby, Handy-Ansichten, Abrechnung, Statistik)
pferderennen/js/comments.js    Rennkommentar: Schlagzeile zu jeder Karte (Führung, Drama, Fotofinish …)
pferderennen/js/odds.js        Live-Chancen per Simulation, Quoten
pferderennen/js/sounds.js      Fanfare, Startschuss, Hufgetrappel, Jubel (WebAudio)
pferderennen/js/engine.js      Spielablauf: Personen/Handys, Wetten, Rennen, Chips, Quoten-Wetten, Verteilen, Statistik
pferderennen/js/race.js        Rennlogik als reine Funktionen: vor, Streckenkarte, zurück, Ziel, Stapel neu mischen, Platzierung
pferderennen/js/cards.js       Deck bauen (52/32), Asse raus, mischen (mit Seed für Tests)
pferderennen/js/controllers.js Rennbahn (Host) / Handy
pferderennen/sw.js             Service Worker (Offline-Fähigkeit)

farbgefuehl/index.html         Farbgefühl: Einstieg
farbgefuehl/css/style.css      Design (Farbtafel, Lupe, Rahmen-Animation)
farbgefuehl/js/app.js          Oberfläche (Tafel mit Lupe, geheime Karte, Hinweis, Aufdecken, Handy-Ansichten, Siegerehrung)
farbgefuehl/js/board.js        Farbtafel berechnen (OKLCH → Hex), Koordinaten A1–P30, Abstand und Punkte
farbgefuehl/js/cards.js        4 Zielfarben ziehen (verschiedene Bereiche, ohne Wiederholung)
farbgefuehl/js/cues.js         Hinweis-Prüfung (Grundfarben, hell/dunkel, Koordinaten, schon benutzt)
farbgefuehl/js/engine.js       Spielregeln: Züge, reihum/gleichzeitig, Wertung, Teams, Stechen, Auszeichnungen
farbgefuehl/js/sounds.js       Stein, Trommelwirbel, Rahmen, Punkte (WebAudio)
farbgefuehl/js/controllers.js  Laptop (Host) / Handy
farbgefuehl/sw.js              Service Worker (Offline-Fähigkeit)

schlecht-erklaert/index.html   Schlecht erklärt: Einstieg
schlecht-erklaert/css/style.css Design (Filmkarte, Hinweise, Auflösung)
schlecht-erklaert/js/app.js    Oberfläche (Leinwand, Hinweise, Auflösung, Handy mit Vorschlägen, Selbst erklären, Melden)
schlecht-erklaert/js/engine.js Spielregeln: Hinweise, Versuche, Punkte, Auswahl, Selbst erklären, Stechen, Auszeichnungen
schlecht-erklaert/js/films.js  Filme einlesen, ziehen ohne Wiederholung, Auswahl-Antworten
schlecht-erklaert/js/titles.js Titel erkennen (Tippfehler, Zahlen, Reihen), Lücken-Hinweis, Vorschläge, verräterische Wörter
schlecht-erklaert/js/controllers.js Laptop (Host) / Handy
schlecht-erklaert/js/filme/    Filme je Kategorie + Serien
schlecht-erklaert/sw.js        Service Worker (Offline-Fähigkeit)

nur-einer/index.html           Nur einer: Einstieg
nur-einer/css/style.css        Design (Zettel, Wortkarte, Kontrolle, Wertung)
nur-einer/js/app.js            Oberfläche (Bühne mit Kontrolle und Raten, Handy als Hinweis-Tafel, ein Gerät, Bestenliste)
nur-einer/js/engine.js         Spielregeln: reihum raten, Phasen, Kartenstapel, Wertung, Varianten, Wettkampf, Auszeichnungen
nur-einer/js/clues.js          Hinweise prüfen: ungültig gegen das Lösungswort, Doppelte gruppieren, Antwort prüfen
nur-einer/js/words.js          Wörter aus allen Quellen (eigene, Guess the word!, Imposter), Stufen, ohne Doppelte
nur-einer/js/woerter.js        Eigene Wortliste (Stufen 1–3)
nur-einer/js/controllers.js    Laptop (Host) / Handy
nur-einer/sw.js                Service Worker (Offline-Fähigkeit)

wavelength/index.html          Wavelength: Einstieg
wavelength/css/style.css       Design (Skala, Abdeckung, Zeiger, Links/Rechts, Aufdecken)
wavelength/js/app.js           Oberfläche (Bühne, Handy mit Ziel bzw. Zeiger zum Ziehen, Abstimmung, ein Gerät, Siegerehrung)
wavelength/js/engine.js        Spielregeln: Phasen, Wertung, Links/Rechts, Aufholregel, Stechen, Kooperativ, Zeitlimit, Auszeichnungen
wavelength/js/dial.js          Halbkreis als SVG (Zielscheibe, Fächer-Abdeckung, Zeiger) und Winkel unter dem Finger
wavelength/js/scales.js        Skalen einlesen, filtern, ziehen ohne Wiederholung
wavelength/js/skalen/          Skalenpaare je Kategorie (Klassisch, Meinung, Kultur, Schräg, Ab 18)
wavelength/js/controllers.js   Laptop (Host) / Handy
wavelength/sw.js               Service Worker (Offline-Fähigkeit)

wortbombe/index.html           Wortbombe: Einstieg
wortbombe/css/style.css        Design (Bombe mit Zündschnur und Funken, BUMM-Blitz)
wortbombe/js/app.js            Oberfläche (Spiel anlegen, Aufgabe, Bombe abspielen, BUMM, Siegerehrung)
wortbombe/js/bomb.js           Zündzeit, Tick-Plan, angezeigter Abbrand, Ticken/Zischen/Knall (WebAudio)
wortbombe/js/engine.js         Spielregeln: Weitergeben reihum, Strafpunkte, Ausscheiden, Wertung, Aufgaben ohne Wiederholung
wortbombe/js/inhalte/          Silben, Anfänge/Enden/Kette, Kategorien (Stufen 1–3)
wortbombe/sw.js                Service Worker (Offline-Fähigkeit)
scripts/wortbombe-stufen.js    Stufen der Silben aus einer Wortliste zählen

skribbl/index.html             Skribbl: Einstieg
skribbl/css/style.css          Design (Zeichenfläche, Lücken-Wort, Chat, Punktetafel, Werkzeuge, Galerie)
skribbl/js/app.js              Oberfläche (Bühne mit Live-Zeichnung und Chat, Handy zum Zeichnen bzw. Raten, Siegerehrung, Galerie)
skribbl/js/engine.js           Spielregeln: reihum zeichnen, Wortwahl, Tipps prüfen, Chat, Hinweise, Punkte, Melden, gefilterte Ansichten
skribbl/js/controllers.js      Laptop (Host, leitet Striche weiter, merkt sich die Galerie) / Handy
skribbl/js/words.js            Begriffe aus allen Quellen, Wortwahl ohne Wiederholung, Tipp prüfen (richtig / knapp / falsch)
skribbl/js/hints.js            Lücken und aufgedeckte Buchstaben
skribbl/js/woerter/            Wortpakete (Tiere, Essen, Berufe, Filme & Serien, Gegenstände, Orte, Aktionen)
skribbl/sw.js                  Service Worker

fluesterpost/index.html        Flüsterpost: Einstieg
fluesterpost/css/style.css     Design (Wartebildschirm, Vorführung, Galerie, Zeichen- und Schreib-Ansichten am Handy)
fluesterpost/js/app.js         Oberfläche (Bühne mit Lobby, Schritten, Vorführung, Galerie; Handy zum Schreiben, Zeichnen, Beschreiben, Herzen)
fluesterpost/js/engine.js      Spielregeln: Schritte, Abgaben, Zwischenstände, Zeit, Vorführung, Herzen, „angekommen?“, gefilterte Ansichten
fluesterpost/js/chain.js       Weitergabe (wer bearbeitet in Schritt k welche Kette) und Schrittarten je Modus
fluesterpost/js/replay.js      Zeichnungen prüfen, verdichten, Strich für Strich nachzeichnen, Kette als Bild
fluesterpost/js/controllers.js Laptop (Host, schickt jedem Handy seine Zeichnung, speichert Bilder getrennt) / Handy
fluesterpost/js/saetze.js      Startsätze (Familie / Ab 18) und Startwörter (aus Guess the word!)
fluesterpost/sw.js             Service Worker

stadt-land-fluss/index.html    Stadt, Land, Fluss: Einstieg
stadt-land-fluss/css/style.css Design (Buchstaben-Kachel, Füllstand, Antwort-Karten, Punkteblock, Wertungstabelle)
stadt-land-fluss/js/app.js     Oberfläche (Bühne mit Buchstabe, Stopp, Abstimmung, Wertung; Handy zum Schreiben und Abstimmen; ein Gerät mit Punkteblock)
stadt-land-fluss/js/engine.js  Spielregeln: Buchstaben, Runden, Antworten, Stopp + Nachspielzeit, Abstimmung, Punkte, Trinkregeln, gefilterte Ansichten
stadt-land-fluss/js/answers.js Anfangsbuchstabe (Ä = A, Artikel), gleiche Antworten zusammenfassen (St. = Sankt), ✓ bekannt
stadt-land-fluss/js/kategorien.js Kategorien-Pakete, Symbole, welche Kategorie eine Hilfsliste hat
stadt-land-fluss/js/listen/    Hilfslisten (Städte, Länder, Flüsse, Tiere, Vornamen) – nur für das ✓ „bekannt“
stadt-land-fluss/js/controllers.js Laptop (Host) / Handy
stadt-land-fluss/sw.js         Service Worker (Offline-Fähigkeit)

who-knows-more/index.html      Who knows more?: Einstieg
who-knows-more/css/style.css   Design
who-knows-more/js/app.js       Oberfläche (Wand, Fragen, Tastatur-Buzzer, Handy-Buzzer, Quizmaster-Ansicht, Finale)
who-knows-more/js/engine.js    Spielregeln: Runden, Buzzer mit Reaktionszeit, Punkte, Joker, Finale, Auszeichnungen
who-knows-more/js/board.js     Wand bauen (Kategorien ziehen, Joker verteilen), eigene Wände, Export/Link, Antworten prüfen
who-knows-more/js/editor.js    Editor für eigene Wände
who-knows-more/js/controllers.js Laptop (Host) / Handy (Buzzer oder Quizmaster)
who-knows-more/js/questions/   Fragenkatalog: eine Datei pro Gruppe, 18+ und Finalfragen
who-knows-more/sw.js           Service Worker (Offline-Fähigkeit)
```
