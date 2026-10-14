# 📏 Schätzfragen – Planung

Wie hoch ist der Eiffelturm? Wie viele Knochen hat ein Baby? Niemand weiß es genau – **wer am nächsten dran
ist, gewinnt**. Der **Laptop** zeigt die Frage und am Ende einen **Zahlenstrahl**, auf dem alle Schätzungen
landen, bevor die richtige Antwort einfliegt. Gespielt wird **mit oder ohne Handys**, **einzeln oder in Teams**.

## Überblick: 2 Modi × 2 Spielweisen

|                          | 🗣️ **Ohne Handy** (Schätzungen am Laptop eintragen) | ✍️ **Mit Handy** (geheim eintippen)              |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------ |
| **📏 Klassisch**          | Alle schreiben auf Zettel, jemand tippt sie ein      | Alle tippen gleichzeitig, Laptop deckt auf       |
| **🎰 Wetten**             | –  (zu viel Eintipperei)                            | Erst schätzen, dann auf die beste Schätzung wetten |

Für alle gleich:
- **Einzeln (2–12 Personen)** oder **1–4 Teams** (pro Team zählt eine Schätzung)
- **Feste Anzahl Fragen** (5 / 10 / 15 / 20), Punkte werden gezählt, Stechen bei Gleichstand
- Am Ende **Siegerehrung** mit Podest, Konfetti und Auszeichnungen

---

## 1. Modus „📏 Klassisch“

### Ablauf

1. Laptop zeigt die Frage + Einheit („**Wie hoch ist der Eiffelturm?** in Metern“).
2. Alle schätzen geheim, Timer läuft (Standard 30 s). Laptop zeigt nur, wer fertig ist (✓).
3. **Aufdecken:** Alle Schätzungen erscheinen auf dem **Zahlenstrahl**, dann fliegt die richtige Antwort ein.
4. Punkte nach **Platzierung**, dazu ein **Fun-Fact** zur Antwort.

### Punkte

| Platz (nächste Schätzung) | 1.  | 2.  | 3.  | Rest |
| ------------------------- | --- | --- | --- | ---- |
| Punkte                    | 3   | 2   | 1   | 0    |

- **🎯 Volltreffer** (höchstens 1 % daneben bzw. exakt bei Jahreszahlen): **+2 Bonus**.
- Gleich weit weg → gleicher Platz, gleiche Punkte.
- Bei **2 Teams / 2 Personen** gibt es nur 3 oder 0 (sonst bekäme der Verlierer immer 2).
- **Wer ist „näher“?** Hängt von der Frage ab:
  - *normale Zahlen* → **relative** Abweichung (bei 300 m sind 30 m daneben genauso gut wie bei 3000 m 300 m)
  - *Jahreszahlen, Prozent, kleine Zahlen* → **absolute** Abweichung
  Die Art steht bei jeder Frage dabei (`skala`).

Option **„Preis ist heiß“**: Wer **drüber** liegt, scheidet für diese Frage aus. Standard: aus.

---

## 2. Modus „🎰 Wetten“ (inspiriert von *Wits & Wagers*)

Auch wer keine Ahnung hat, kann gewinnen – indem man erkennt, wer sich auskennt.

1. Alle schätzen geheim (wie Klassisch).
2. Die Schätzungen werden **sortiert** nebeneinander gezeigt, ganz links ein Feld **„Alle zu hoch“**.
3. Jede Person setzt **2 Chips** auf eine oder zwei Schätzungen (auch die eigene).
4. Gewinnt die Schätzung, die am nächsten dran ist, **ohne drüber zu liegen**.
   - Chip auf der Gewinner-Schätzung → **+Quote** (Mitte 2, weiter außen 3, ganz außen / „Alle zu hoch“ 5)
   - Wer die Gewinner-Schätzung **abgegeben** hat → **+3**

Etwas komplexer, darum Etappe 3.

---

## 3. Spielweisen

### Ohne Handy 🗣️

- Jede Person / jedes Team schreibt die Schätzung auf einen Zettel.
- Laptop zeigt Eingabefelder mit allen Namen; jemand tippt die Zahlen ein → **Aufdecken**.
- Nur Klassisch.

### Mit Handy ✍️

- QR-Code scannen, Namen (und ggf. Team) wählen.
- Handy zeigt Frage + Einheit + Zahlenfeld (`inputmode="decimal"`) und Knöpfe **Tsd / Mio / Mrd**.
- Darunter die Rückmeldung, wie die Zahl verstanden wurde: „= **1.500.000 m**“.
- Ändern bis zum Ablauf der Zeit möglich. Nicht abgegeben = keine Punkte.
- **Teams:** Jedes Teammitglied darf tippen, die **zuletzt** festgelegte Zahl zählt; alle im Team sehen sie live
  (zum Diskutieren).

### Zahlen verstehen

| Eingabe       | Ergebnis   |
| ------------- | ---------- |
| `330`         | 330        |
| `1.500`       | 1500 (deutsche Tausenderpunkte) |
| `1,5`         | 1,5        |
| `1,5 Mio` / `1,5 + [Mio]` | 1.500.000 |
| `2 mrd`       | 2.000.000.000 |
| `-500` (Jahr) | 500 v. Chr. |

---

## 4. Fragen

- Ca. **300 Fragen**, gemischt aus Kategorien, ohne Wiederholung über mehrere Spiele (`localStorage`).
- **Jede Antwort mit Quelle und Stand-Jahr** – Schätzfragen leben davon, dass die Antwort stimmt.
  Beim Schreiben der Liste wird jede Zahl geprüft; Fragen mit wackeligen oder sich schnell ändernden Werten
  (Follower-Zahlen, Preise) fliegen raus.

| Kategorie     | Beispiel                                                    | Skala     |
| ------------- | ----------------------------------------------------------- | --------- |
| Geografie     | Wie lang ist der Rhein? (km)                                 | relativ   |
| Körper        | Wie viele Knochen hat ein erwachsener Mensch?               | absolut   |
| Tiere         | Wie schwer ist ein Blauwal-Herz? (kg)                        | relativ   |
| Geschichte    | In welchem Jahr wurde der Buchdruck erfunden?                | absolut   |
| Weltall       | Wie weit ist der Mond entfernt? (km)                         | relativ   |
| Alltag        | Wie viele Gummibärchen sind in einer 200-g-Tüte? (ca.)       | relativ   |
| Rekorde       | Wie lange dauerte der längste Kuss der Welt? (Stunden)       | relativ   |
| Prozent       | Wie viel Prozent der Erde sind mit Wasser bedeckt?          | absolut   |

Format (`js/questions/fragen.js`), eine Zeile pro Frage:

```
Kategorie|Frage|Antwort|Einheit|Skala|Fun-Fact|Quelle
Geografie|Wie hoch ist der Eiffelturm?|330|m|rel|Im Sommer ist er durch die Hitze bis zu 15 cm höher.|toureiffel.paris (2024)
```

Später: **eigene Fragen** (wie die eigene Wand bei Jeopardy) – Liste einfügen, im Browser speichern.

---

## 5. Einstellungen

| Option          | Werte                                    | Standard  |
| --------------- | ---------------------------------------- | --------- |
| Modus           | Klassisch / Wetten                       | Klassisch |
| Spielweise      | Ohne Handy / Mit Handy                   | Mit Handy |
| Spielen als     | Einzeln / Teams (1–4)                    | Einzeln   |
| Fragen          | 5 / 10 / 15 / 20                         | 10        |
| Zeit pro Frage  | aus / 20 / 30 / 45 / 60 Sekunden         | 30        |
| Kategorien      | Auswahl (alle an)                        | alle      |
| „Preis ist heiß“| an / aus                                 | aus       |

---

## 6. Bildschirme

### Laptop – Frage

```
┌───────────────────────────────────────────────────────────────────────┐
│ 📏 Schätzfragen · Geografie                    Frage 4 / 10   ⏱ 0:21  │
│                                                                       │
│                  Wie hoch ist der Eiffelturm?                         │
│                          (in Metern)                                  │
│                                                                       │
│   Anna ✓   Ben 💭   Cem ✓   Dora ✓   Eli 💭   Finn ✓                   │
├───────────────────────────────────────────────────────────────────────┤
│  Anna 9 · Cem 7 · Dora 6 · Finn 4 · Ben 3 · Eli 1                      │
└───────────────────────────────────────────────────────────────────────┘
```

### Laptop – Aufdecken (Zahlenstrahl)

```
┌───────────────────────────────────────────────────────────────────────┐
│                  Wie hoch ist der Eiffelturm?                         │
│                                                                       │
│      Eli      Ben        Anna  ▼ 330 m   Cem              Dora  Finn   │
│      120      200        310   ┃         350              800   1000   │
│  ────●────────●───────────●────┃──────────●────────────────●─────●──── │
│                                ┃                                      │
│      🥇 Anna +3 (−6 %)   🥈 Cem +2 (+6 %)   🥉 Ben +1                    │
│                                                                       │
│  💡 Im Sommer ist er durch die Hitze bis zu 15 cm höher.               │
└───────────────────────────────────────────────────────────────────────┘
```

Bei großen Abständen ist der Zahlenstrahl **logarithmisch**, sonst linear.

### Handy

```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│ Frage 4 / 10    ⏱ 0:21  │   │ Frage 4 / 10    ⏱ 0:09  │   │ 🎰 Wetten               │
│                         │   │                         │   │ Setze 2 Chips:          │
│ Wie hoch ist der        │   │  Deine Schätzung:       │   │  zu hoch   [ ]          │
│ Eiffelturm? (m)         │   │    310 m  ✓             │   │  200       [●]          │
│ ┌─────────────────────┐ │   │  [ Ändern ]             │   │  310       [●]          │
│ │ 310_                │ │   │                         │   │  350       [ ]          │
│ └─────────────────────┘ │   │  Warte auf Ben, Eli 💭  │   │  800       [ ]          │
│ [Tsd] [Mio] [Mrd]       │   │                         │   │                         │
│ = 310 m                 │   │ 👀 Schau auf den Laptop │   │  [  Wetten ✓  ]         │
│ [   Festlegen ✓   ]     │   │                         │   │                         │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

Auszeichnungen: „🎯 Scharfschütze (meiste Volltreffer)“, „🌍 Größenwahn (weiteste Schätzung)“,
„🧭 Bauchgefühl (durchschnittlich am nächsten)“, „🎰 Glücksritter (meiste Wett-Punkte)“.

---

## 7. Technische Umsetzung

### Ordner & Adresse

```
schaetzfragen/                  → https://tbnsuperkid.github.io/schaetzfragen/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/questions/fragen.js        Fragenliste
  js/number.js                  Zahlen einlesen („1,5 Mio“) und schön anzeigen
  js/engine.js                  Spieler/Teams, Fragen, Abweichung, Punkte, Wetten, Stechen, Auszeichnungen
  js/controllers.js             Bühne (Laptop) / Mitspieler (Handy)
  js/app.js                     Oberfläche, Zahlenstrahl
tests/schaetzfragen.test.js
```

### Architektur

- Gleiches Muster wie 2 Dumme: **Laptop = Host + Bühne**, Handys schicken `join`, `estimate`, `bet`.
- Schätzungen der anderen bleiben bis zum Aufdecken geheim (gefilterte Ansicht);
  im Team-Modus sieht das eigene Team die Team-Schätzung live.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { mode: 'classic' | 'bet', input: 'write', grouping: 'solo' | 'teams', count: 10, seconds: 30, priceIsRight: false },
    players: [{ id, name, team, score, connected }],
    teams: [...],                               // nur bei grouping: 'teams'
    index: 3,                                   // aktuelle Frage
    question: { text, answer: 330, unit: 'm', scale: 'rel', fact, source },
    phase: 'lobby' | 'estimate' | 'bet' | 'reveal' | 'scores' | 'tiebreak' | 'end',
    estimates: { [playerOrTeamId]: 310 },       // geheim bis 'reveal'
    bets: { [playerId]: [estimateId, estimateId] },
    history: [ … ]
  }
  ```

### Tests

- Zahlen einlesen: Tausenderpunkte, Komma, Mio/Mrd, negative Jahre, Unsinn wird abgelehnt
- Abweichung relativ vs. absolut, Platzierung bei Gleichstand, 2-Spieler-Sonderfall, Volltreffer-Bonus
- „Preis ist heiß“: Überbieter scheiden aus, alle drüber → niemand gewinnt
- Wetten: Gewinner = nächste ohne drüber, „Alle zu hoch“, Quoten, Punkte für Schätzer + Wettende
- Gefilterte Ansicht verrät keine fremden Schätzungen vor dem Aufdecken
- Fragenliste: jede Zeile vollständig, Antwort ist Zahl, Skala gültig, keine Dopplungen, Mindestanzahl

---

## 8. Umsetzung in Etappen

| Etappe | Inhalt                                                                              | Ergebnis                      |
| ------ | ----------------------------------------------------------------------------------- | ----------------------------- |
| **1**  | Klassisch **ohne Handy**, Punkte, Zahlenstrahl, 100 geprüfte Fragen, Karte auf der Startseite | Spielbar mit einem Laptop |
| **2**  | **Mit Handy**: Raum + QR, Zahleneingabe, Teams, Wiederverbinden                       | Das volle Erlebnis 📏         |
| **3**  | Modus **Wetten**, „Preis ist heiß“, Auszeichnungen, Animationen                       | Mehr Abwechslung 🎰           |
| **4**  | Fragen auf 300, eigene Fragen                                                         | Fertig 🎉                     |

---

## 9. Offene Entscheidungen

1. **Einzeln oder Teams als Standard?** *Vorschlag:* einzeln – Schätzen ist ein Bauchgefühl-Spiel.
2. **Punkte:** Platzierung 3/2/1 (einfach) oder Punkte nach Abweichung (z. B. 10 Punkte bei Volltreffer,
   0 ab doppelt/halb so viel)? *Vorschlag:* Platzierung.
3. **Wetten-Modus** überhaupt? Macht vor allem bei 5+ Leuten Spaß.
4. **Themen-Wünsche** für die Fragen (z. B. regionale Fragen, Insider)?
