# ✍️ Stadt, Land, Fluss – Planung

Der Klassiker: Ein **Buchstabe** wird gezogen, alle füllen so schnell wie möglich **Kategorien** aus – *Stadt, Land,
Fluss, Name, Tier, Beruf …*. Wer zuerst fertig ist, ruft **„Stopp!“**. Dann wird verglichen: einzigartige Antworten
bringen mehr Punkte als doppelte.

Kein Markenspiel, also kein neuer Name nötig. Der **Laptop** ist die **Bühne** (Buchstabe, Zeit, Auswertung),
geschrieben wird auf den **Handys**. Mit einem Gerät ist die App nur Buchstaben-Zieher + Timer + Punkteblock.

> Name: **Stadt, Land, Fluss**, Ordner `stadt-land-fluss/`.

## Überblick

|                     | 🖥️ **Ein Gerät** (mit Zetteln)                    | 📱 **Mit Handys**                                     |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| **Buchstabe**        | Laptop zieht (mit Animation)                      | Laptop zieht, steht auf allen Handys                  |
| **Schreiben**        | auf Papier                                       | auf dem Handy, eine Zeile pro Kategorie               |
| **Stopp**            | laut / Knopf am Laptop                            | Knopf auf dem Handy, alle anderen haben noch 3 s      |
| **Auswerten**        | vorlesen, Punkte am Laptop eintragen              | App vergleicht, **Gruppe stimmt** über Zweifelsfälle ab |

- **2–12 Personen** einzeln (Teams optional: ein Handy pro Team)
- **5 / 8 / 10 Runden**, danach Siegerehrung
- Aufwand gering: keine Fragen, nur **Kategorien-Listen**. Die Arbeit steckt in der **Abstimmung**, die schnell
  und fair sein muss.

---

## 1. Regeln

### Ablauf einer Runde

1. **Buchstabe:** Zufällig aus A–Z ohne **Q, X, Y** (abschaltbar). Jeder Buchstabe nur einmal pro Spiel.
   Option **„ABC im Kopf“** wie früher: einer sagt still das Alphabet auf, ein anderer ruft Stopp – lustig, aber
   per Zufall geht's schneller.
2. **Schreiben:** Alle füllen ihre Kategorien. Antworten müssen mit dem Buchstaben **beginnen** (das Handy prüft
   das sofort und färbt falsche Anfangsbuchstaben rot).
3. **Stopp:** Wer **alle** Kategorien gefüllt hat, darf Stopp drücken. Danach **3 Sekunden** Nachspielzeit
   (Countdown auf allen Handys), dann ist Schluss. Alternativ **feste Zeit** (Standard 90 s).
4. **Auswerten** – Kategorie für Kategorie:
   - App sortiert die Antworten, **gleiche Antworten** (über `shared/match.js`: Groß/klein, Tippfehler,
     *„Bremen“* / *„bremen“*) werden zusammengefasst
   - Die Bühne zeigt alle Antworten einer Kategorie; jede/r kann eine Antwort mit **👎** anzweifeln
   - Antworten mit **Mehrheit 👎** zählen nicht. Bei Gleichstand entscheidet die Spielleitung.
5. **Punkte:**

   | Fall                                                         | Punkte |
   | ------------------------------------------------------------ | ------ |
   | Einzige Person mit einer **gültigen** Antwort in der Kategorie | **20** |
   | Antwort **einzigartig** (andere haben andere Antworten)       | **10** |
   | Antwort **doppelt** (mind. eine andere Person hat dieselbe)   | **5**  |
   | leer oder ungültig                                           | 0      |

### Gültig oder nicht?

Die App entscheidet **nichts inhaltlich** (sie kennt nicht jede Stadt der Welt) – nur Anfangsbuchstabe und
Doppelte. Ob *„Lummerland“* als Land zählt, entscheidet die Gruppe. Optional: kleine **Wörterlisten** für die
Standard-Kategorien (Städte, Länder, Flüsse, Tiere, Vornamen) aus freien Daten – dann zeigt die Bühne ein
✓ *„bekannt“* neben der Antwort, als Hilfe bei der Abstimmung, aber nie als Urteil.

---

## 2. Kategorien 📋

- **Standard:** Stadt · Land · Fluss · Name · Tier · Beruf
- **Pakete** zum Austauschen oder Mischen (Datei `js/kategorien.js`):

| Paket           | Beispiele                                                                   |
| --------------- | --------------------------------------------------------------------------- |
| 🏠 Klassisch     | Stadt, Land, Fluss, Name, Tier, Beruf, Pflanze, Marke                       |
| 🎬 Popkultur     | Film, Serie, Band/Musiker, Promi, Videospiel, Comicfigur                    |
| 🍔 Essen         | Gericht, Getränk, Obst/Gemüse, Süßigkeit, Gewürz                            |
| 🤪 Lustig        | Grund zu spät zu kommen, Ausrede, Schimpfwort (harmlos), Etwas im Kühlschrank, Was man nicht zur Oma sagt |
| 🔥 Ab 18         | Trinkspiel, Anmachspruch, Peinlicher Moment (Standard aus)                   |

- **Eigene Kategorien** eintippen, im Browser gespeichert
- **Zufalls-Modus:** jede Runde 6 andere Kategorien aus allen gewählten Paketen

---

## 3. Einstellungen

| Option              | Werte                                       | Standard          |
| ------------------- | ------------------------------------------- | ----------------- |
| Spielweise          | Mit Handys / Ein Gerät                      | Mit Handys        |
| Runden              | 5 / 8 / 10                                  | 8                 |
| Rundenende          | Stopp (+3 s) / feste Zeit / beides          | beides (Stopp, max. 120 s) |
| Zeit                | 60 / 90 / 120 / 180 s                       | 120 s             |
| Kategorien          | Standard / Pakete / eigene / Zufall          | Standard          |
| Schwere Buchstaben  | ohne Q, X, Y / alle                         | ohne              |
| Punkte              | 20/10/5 / einfach (10/5)                    | 20/10/5           |
| Abstimmung          | alle Antworten / nur angezweifelte          | nur angezweifelte |
| 🍻 Trinkregeln       | 0 Punkte in einer Kategorie → 1 Schluck, Stopp-Rufer mit Fehler → 2 | aus |

---

## 4. Bildschirme

### Laptop – Schreiben

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✍️ Stadt, Land, Fluss · Runde 3/8                     ⏱ 1:12             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                              ┌─────┐                                     │
│                              │  M  │                                     │
│                              └─────┘                                     │
│                                                                          │
│     Stadt · Land · Fluss · Name · Tier · Beruf                           │
│                                                                          │
│     Anna ▰▰▰▰▱▱   Ben ▰▰▰▰▰▰ ✋   Cem ▰▰▱▱▱▱   Dora ▰▰▰▰▰▱               │
└──────────────────────────────────────────────────────────────────────────┘
```

### Laptop – Auswerten (Kategorie für Kategorie)

```
│  🏙️ STADT mit M                                                          │
│   München (Anna, Cem)  5 · 5      Madrid (Ben)  10      Mainz (Dora) 10   │
│   Mordor (Eli)  👎👎👎 ✗ zählt nicht                                          │
│                                            [ Weiter → Land ]             │
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ ✍️ Buchstabe M  ⏱ 1:12    │  │ 🏙️ Stadt mit M           │
│ Stadt  [ München    ] ✓ │  │   München (du, Cem)      │
│ Land   [ Mexiko     ] ✓ │  │   Madrid       [ 👎 ]     │
│ Fluss  [ Main       ] ✓ │  │   Mainz        [ 👎 ]     │
│ Name   [ Lisa       ] ✗ │  │   Mordor       [ 👎 ] ✓   │
│ Tier   [            ]   │  │                         │
│ Beruf  [ Maurer     ] ✓ │  │   [ Alles ok ✓ ]          │
│ [ ✋ STOPP ] (erst wenn voll)│ │                         │
└─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „⚡ Schnellste/r“ (meiste Stopps), „🦄 Kreativ“ (meiste 20er), „🤝 Mainstream“ (meiste 5er),
„🤨 Erwischt“ (meiste weggestimmte Antworten) und die lustigste weggestimmte Antwort.

---

## 5. Technische Umsetzung

### Ordner

```
stadt-land-fluss/               → https://tbnsuperkid.github.io/stadt-land-fluss/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/kategorien.js              Pakete
  js/listen/staedte.js …        optional: Hilfslisten (freie Daten), nur für ✓ „bekannt“
  js/engine.js                  Buchstaben, Runden, Antworten, Stopp, Gruppieren, Abstimmung, Punkte, Ansichten
  js/controllers.js             GameRoom.create({ game: 'stadt-land-fluss', net: 'slf-v1-', storage: 'slf', engine })
  js/app.js
tests/stadt-land-fluss.test.js
```

### Architektur

- Handys schicken `join`, `answer` ({ kategorie, text } – bei jeder Änderung, gedrosselt), `stop`, `veto`, `ok`, `next`.
- Antworten liegen **nur auf dem Laptop**; während des Schreibens sieht jedes Handy nur die eigenen, die Bühne nur
  den **Füllstand** (▰▰▱).
- Antworten werden **laufend** gespeichert – wer beim Stopp die Verbindung verliert, verliert nichts.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { input: 'phones', rounds: 8, end: 'both', time: 120, categories: ['Stadt', …], hard: false, scoring: '20-10-5' },
    players: [{ id, name, score, stats: { stops: 2, twenty: 3, five: 6, vetoed: 1 }, connected }],
    round: 3, letter: 'M', usedLetters: ['B', 'S', 'M'],
    answers: { p1: { Stadt: 'München', Land: 'Mexiko', … }, … },
    stopBy: 'p2', stopAt: 1730000000000,
    review: { cat: 0, vetoes: { 'Stadt:mordor': ['p1', 'p2', 'p3'] } },
    phase: 'lobby' | 'write' | 'grace' | 'review' | 'scores' | 'end'
  }
  ```

### Tests

- Buchstabe nie doppelt, Q/X/Y-Schalter
- Anfangsbuchstabe: *„Ölberg“* bei Ö, Umlaute (*Ä* zählt für *A*? → einstellbar, Standard: ja)
- Gruppieren: Groß/klein, Tippfehler, Artikel (*„Die Mosel“*)
- Punkte 20/10/5/0 inkl. „einzige gültige Antwort“, nachdem andere weggestimmt wurden
- Stopp nur mit allen Feldern, 3 s Nachspielzeit, feste Zeit
- Mehrheit 👎, Gleichstand → Spielleitung
- **Gefilterte Ansicht:** Während `write` sieht niemand fremde Antworten

---

## 6. Umsetzung in Etappen

| Etappe | Inhalt                                                                 | Ergebnis       |
| ------ | ---------------------------------------------------------------------- | -------------- |
| **1**  | Ein Gerät: Buchstabe ziehen, Timer, Kategorien, Punkte eintragen, Karte auf der Startseite | Sofort nutzbar ✍️ |
| **2**  | Mit Handys: Schreiben, Stopp, Gruppieren, Abstimmung, Punkte            | Das volle Erlebnis 📱 |
| **3**  | Pakete, eigene Kategorien, Zufall, Statistik, Hilfslisten, Trinkregeln, Sounds | Fertig 🎉 |

## 7. Offene Entscheidungen

1. Zählt **Ä als A** (und Ö/Ü)? Und *„St.“* bei *Sankt Petersburg*?
2. Abstimmung über **alle** Antworten (gründlich) oder nur **angezweifelte** (schnell)?
3. Hilfslisten mit Städten/Ländern einbauen oder ganz auf die Gruppe verlassen?
