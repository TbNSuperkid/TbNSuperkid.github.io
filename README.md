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

### Neues Spiel hinzufügen

1. Einen neuen Ordner anlegen, z. B. `quiz/`, mit einer eigenen `index.html`
   - gemeinsame Bibliotheken & Schriften liegen in `vendor/` (erreichbar über `../vendor/…`)
   - gemeinsamer Code liegt in `shared/`: Handy-Verbindung (`room.js` auf Basis von `net.js`),
     Sounds & Konfetti (`fx.js`, eigene Sounds über `GameFx.synth`) und `config.js`
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
  oder jede/r für sich, dann zählt der **Median** des Teams.
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
  weder Raum noch Internet. Notlösung ohne Handy: Schlüssel kurz am Laptop einblenden.
- **📱 Alle mit Handy:** Raum + Lobby wie bei 2 Dumme. Der Chef tippt den Hinweis ein (Wörter auf dem Feld, Teilwörter
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
shared/config.js               Transport-Wahl (der Node-Server liefert hier „ws“ aus)
server/server.js               optionaler Node-Server (statische Dateien + WebSocket-Relay)
tests/                         Tests (npm test)

guess-the-word/index.html      Guess the word!: Einstieg
guess-the-word/css/style.css   Design
guess-the-word/js/app.js       Oberfläche (Bildschirme, Brett, Stapel, Karten, Timer)
guess-the-word/js/engine.js    Spielregeln & Spielzustand
guess-the-word/js/deck.js      Kartenstapel (Ziehen ohne Wiederholungen)
guess-the-word/js/controllers.js Offline (+ Handy-Kartenhand) / Online-Host / Online-Mitspieler
guess-the-word/js/sketch.js    Zeichenfläche
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
