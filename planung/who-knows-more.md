# 🧩 Who knows more? – Planung

Das Quiz mit der **Fragenwand**: Kategorien nebeneinander, darunter Felder mit steigendem Wert. Wer ein Feld
wählt, sieht die Frage – wer zuerst **buzzert** und richtig antwortet, bekommt die Punkte, bei falscher Antwort
gibt es Minuspunkte. Der **Laptop** (oder Fernseher) ist die Wand, die **Handys sind Buzzer**.

## Überblick: 2 Spielweisen × 2 Rollen

|                         | 🗣️ **Ohne Handy** (nur Laptop)                         | 📱 **Mit Handy** (Handys als Buzzer)                       |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| **🎤 Mit Quizmaster**    | Quizmaster bedient den Laptop, Teams rufen / drücken eine Taste | Quizmaster sieht die Antwort auf dem eigenen Handy, Teams buzzern |
| **🤝 Ohne Quizmaster**   | Alle spielen, Antwort wird nach dem Buzzern aufgedeckt, die Runde entscheidet | wie links, aber mit Handy-Buzzern                |

Für alle Varianten gleich:
- **1–4 Teams** in Rot, Blau, Grün, Gelb (wie Guess the word! / 2 Dumme), wer allein spielt, ist ein 1-Personen-Team
- **Runde 1** (100–500), **Runde 2** mit doppelten Werten (200–1000), dann das **Finale** mit Einsatz
- Wer am Ende die meisten Punkte hat, gewinnt → **Siegerehrung** mit Podest und Konfetti
- Fragen aus dem **eingebauten Katalog** oder einer **eigenen Wand** (Editor, siehe unten)

---

## 1. Ablauf einer Runde

### Die Wand

```
   Tiere      Geografie    Film & TV     Essen      Sprache     Sport
   100          100          100          100         100        100
   200          200          ░░░          200         200        200
   300          ░░░          300          300         300        300
   400          400          400          400         ░░░        400
   500          500          500          500         500        500
```

1. Das Team, das **dran ist**, wählt ein Feld (Klick auf dem Laptop bzw. per Handy).
2. Die Frage erscheint groß, der Quizmaster liest vor (oder alle lesen mit).
3. **Buzzer frei** (Signalton + Rahmen leuchtet). Wer **vorher** drückt, ist 0,5 Sekunden gesperrt.
4. Das schnellste Team antwortet **laut**:
   - **Richtig** → +Wert, dieses Team wählt das nächste Feld.
   - **Falsch** → −Wert, der Buzzer ist für die anderen Teams wieder frei.
   - **Niemand** buzzert in 10 Sekunden → Antwort wird gezeigt, Feld ist weg, gleiches Team wählt weiter.
5. Die Runde ist vorbei, wenn alle Felder weg sind (oder das Zeitlimit der Runde abläuft, optional).

**Start:** Das Team mit den wenigsten Punkten beginnt die nächste Runde (Runde 1: zufällig).

### 🎲 Joker-Feld

- Runde 1: **1 verstecktes Joker-Feld**, Runde 2: **2**. Nie in der obersten Reihe.
- Nur das Team, das das Feld gewählt hat, darf antworten – vorher setzt es einen **Einsatz**:
  zwischen 5 und dem eigenen Punktestand (mindestens bis zum höchsten Feldwert der Runde, auch bei 0 Punkten).
- Richtig → +Einsatz, falsch → −Einsatz.

### 🏁 Finale

1. Die **Kategorie** wird gezeigt (noch nicht die Frage).
2. Jedes Team mit **mehr als 0 Punkten** setzt **geheim** einen Einsatz (0 bis eigener Punktestand).
3. Die Frage erscheint, **30 Sekunden** Zeit, jedes Team schreibt seine Antwort geheim auf
   (Handy oder Zettel).
4. Aufdecken **vom letzten zum ersten Platz**: Antwort, richtig/falsch, Einsatz, neuer Stand.

### Punkte (Standard)

| Was                   | Runde 1     | Runde 2      | Finale          |
| --------------------- | ----------- | ------------ | --------------- |
| Feldwerte             | 100 … 500   | 200 … 1000   | –               |
| Richtig               | +Wert       | +Wert        | +Einsatz        |
| Falsch                | −Wert       | −Wert        | −Einsatz        |
| Joker-Feld            | ±Einsatz    | ±Einsatz     | –               |

Option **„Ohne Minuspunkte“** für entspanntere Runden (falsch = 0).

---

## 2. Spielweisen

### Ohne Handy 🗣️

- **Buzzer = Laptop-Tastatur:** Jedes Team bekommt eine Taste (🔴 `A`, 🔵 `F`, 🟢 `J`, 🟡 `L`), groß
  auf dem Bildschirm angezeigt. Wer zuerst drückt, ist dran.
  *Alternative:* Teams rufen, der Quizmaster klickt das Team an.
- Der Quizmaster (oder die Person am Laptop) klickt **✓ Richtig** / **✗ Falsch**.
- Finale-Einsätze und -Antworten auf Zettel, Eintragen am Laptop.

### Mit Handy 📱

- Alle scannen den **QR-Code**, wählen ihr Team → das Handy ist ein **großer Buzzer-Knopf** in Teamfarbe.
- Das Team, das dran ist, kann das Feld auch **auf dem Handy wählen** (Mini-Wand).
- Joker-Einsatz, Finale-Einsatz und Finale-Antwort werden **geheim auf dem Handy** eingetippt.
- Vibrieren + Ton, wenn man den Buzzer gewonnen hat.

### Fairer Buzzer übers Netz

Handys haben unterschiedliche Verzögerungen (WLAN, Mobilfunk, PeerJS ~20–200 ms). Damit nicht das schnellste
Netz gewinnt, sondern die schnellste Hand:

1. Laptop schickt `buzzer-open`. Jedes Handy misst **lokal**, wie viele Millisekunden zwischen Empfang und
   Drücken vergehen (Reaktionszeit).
2. Das Handy schickt `{ buzz, reaction: 412 }`.
3. Der Laptop wartet nach dem ersten Buzz noch **250 ms** auf weitere und nimmt die **kleinste Reaktionszeit**.
4. Zu frühes Drücken (vor `buzzer-open`) → 0,5 s Sperre, angezeigt auf dem Handy.

(Mogeln ist theoretisch möglich, unter Freunden egal.)

### Rolle Quizmaster 🎤

| Option                 | Wer sieht die Antwort?                                      |
| ---------------------- | ----------------------------------------------------------- |
| **Mit Quizmaster**     | Die Quizmaster-Person – auf ihrem Handy („Quizmaster-Ansicht“) oder auf dem Laptop, wenn nur der Laptop da ist |
| **Ohne Quizmaster**    | Niemand vorher. Nach der Antwort klickt man **Antwort zeigen**, dann entscheidet die Runde **✓ / ✗** |

Bei „Ohne Quizmaster“ zählt die Antwort, wenn sie **sinngemäß** stimmt; im Zweifel entscheiden die anderen Teams.

---

## 3. Fragen

### Eingebauter Katalog

- Ca. **40 Kategorien × 5 Fragen** (200 Fragen) + **30 Finalfragen**, aufsteigend schwerer.
- Pro Spiel werden 6 Kategorien je Runde gezogen, **ohne Wiederholung** über mehrere Spiele (`localStorage`).
- Normale Frage → Antwort. Option **„Umgekehrt“**: Die Wand zeigt die *Antwort*, gesucht ist die *Frage*
  („Dieses Tier schläft bis zu 22 Stunden am Tag.“ → „Was ist ein Koala?“). Standard: aus.

| Kategorie-Art     | Beispiele                                                          |
| ----------------- | ------------------------------------------------------------------ |
| Wissen            | Tiere, Geografie, Weltall, Körper, Geschichte, Erfindungen          |
| Popkultur         | Film & TV, Musik, Videospiele, Disney, Serien, Memes               |
| Alltag            | Essen & Trinken, Marken, Deutschland, Sprichwörter                  |
| Wortspiele        | „Fängt mit Z an“, „Reimt sich auf Haus“, „Rückwärts gelesen“, „Emoji-Rätsel“ |

Format (`js/questions/katalog.js`), eine Kategorie pro Block:

```js
{ name: 'Tiere', fragen: [
  'Wie nennt man ein junges Pferd?|Fohlen',
  'Welches Tier hat drei Herzen?|Tintenfisch (Oktopus)',
  …                                   // 5 Fragen, leicht → schwer
] }
```

### ✏️ Eigene Wand

Für Geburtstage, Insider-Runden, Schulquiz – das ist der größte Spaß-Faktor:

- **Editor** am Laptop: Kategorien benennen, Fragen + Antworten eintragen, Joker-Felder setzen, Finalfrage.
- Gespeichert im Browser, mehrere Wände möglich, **Export/Import als Datei** (`.json`).
- **Teilen per Link:** Die Wand wird komprimiert in den Link gepackt (`who-knows-more/#wand=…`), passt für normale
  Wände (~6 KB).
- Optional **Bilder** als Frage (URL) – Etappe 3.
- Gemischt: eigene Kategorien + aufgefüllt aus dem Katalog.

---

## 4. Einstellungen

| Option              | Werte                                         | Standard          |
| ------------------- | --------------------------------------------- | ----------------- |
| Spielweise          | Ohne Handy / Mit Handy                        | Mit Handy         |
| Quizmaster          | mit / ohne                                    | ohne              |
| Teams               | 1–4                                           | 2                 |
| Fragen              | Katalog / eigene Wand / gemischt              | Katalog           |
| Länge               | Kurz (1 Runde + Finale) / Normal (2 Runden + Finale) | Normal     |
| Kategorien pro Runde| 4 / 5 / 6                                     | 6                 |
| Joker-Felder        | an / aus                                      | an                |
| Minuspunkte         | an / aus                                      | an                |
| Antwortzeit         | 5 / 10 / 15 Sekunden nach dem Buzzern         | 10                |
| Umgekehrt           | an / aus                                      | aus               |

---

## 5. Bildschirme

### Laptop – Wand

```
┌───────────────────────────────────────────────────────────────────────┐
│ 🧩 Who knows more? · Runde 1                   🔴 Die Roten wählen     │
├──────────┬──────────┬──────────┬──────────┬──────────┬────────────────┤
│  TIERE   │GEOGRAFIE │ FILM &TV │  ESSEN   │ SPRACHE  │     SPORT      │
├──────────┼──────────┼──────────┼──────────┼──────────┼────────────────┤
│   100    │   100    │   100    │   100    │   100    │      100       │
│   200    │   200    │          │   200    │   200    │      200       │
│   300    │          │   300    │   300    │   300    │      300       │
│   400    │   400    │   400    │   400    │          │      400       │
│   500    │   500    │   500    │   500    │   500    │      500       │
├──────────┴──────────┴──────────┴──────────┴──────────┴────────────────┤
│  🔴 Die Roten 1200     🔵 Blau-Wal 700      🟢 Grünzeug −100           │
└───────────────────────────────────────────────────────────────────────┘
```

### Laptop – Frage

```
┌───────────────────────────────────────────────────────────────────────┐
│ TIERE · 300                                              ⏱ ▓▓▓▓▓░░░    │
│                                                                       │
│          Welches Tier kann seinen Magen nach außen stülpen,           │
│                    um Beute zu verdauen?                              │
│                                                                       │
│                 🔵 Blau-Wal hat gebuzzert! (0,41 s)                    │
│                                                                       │
│        [ ✓ Richtig ]     [ ✗ Falsch ]     [ Antwort zeigen ]           │
└───────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│ 🔵 Blau-Wal       700   │   │ 🔵 Blau-Wal       700   │   │ 🎤 Quizmaster           │
│                         │   │                         │   │                         │
│     ┌─────────────┐     │   │   🎲 JOKER-FELD!         │   │ TIERE · 300             │
│     │             │     │   │                         │   │ Welches Tier kann …     │
│     │   BUZZ!     │     │   │   Euer Einsatz:         │   │                         │
│     │             │     │   │   [ 500         ]       │   │ Antwort: Seestern       │
│     └─────────────┘     │   │   (5 – 700)             │   │                         │
│                         │   │   [   Setzen ✓   ]      │   │ 🔵 Blau-Wal buzzert      │
│   👀 Schau auf die Wand  │   │                         │   │ [ ✓ ]        [ ✗ ]      │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
          Buzzer                    Einsatz (geheim)              Quizmaster
```

Auszeichnungen am Ende: „⚡ Schnellster Buzzer“, „🎯 Treffsicher (meiste Richtige)“, „🎲 Zocker (höchster
Einsatz)“, „🙈 Voreilig (meiste Fehlbuzzer)“.

---

## 6. Technische Umsetzung

### Ordner & Adresse

```
who-knows-more/                 → https://tbnsuperkid.github.io/who-knows-more/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/questions/katalog.js       eingebaute Kategorien + Finalfragen
  js/board.js                   Wand bauen (Kategorien ziehen, Joker verteilen), eigene Wände laden/speichern/teilen
  js/engine.js                  Teams, Runden, Buzzer, Punkte, Einsätze, Finale, Auszeichnungen
  js/controllers.js             Bühne (Laptop, Host) / Mitspieler (Handy) / Quizmaster (Handy)
  js/editor.js                  Editor für eigene Wände
  js/app.js                     Oberfläche
tests/who-knows-more.test.js
```

### Architektur

- Wie bei 2 Dumme: **Laptop ist immer Host** und Bühne, spielt nicht selbst mit.
- Handys schicken nur Aktionen: `join`, `pick`, `buzz {reaction}`, `wager`, `final-answer`, `judge` (nur Quizmaster).
- **Gefilterte Ansicht:** Antworten nur an die Quizmaster-Ansicht, Finale-Einsätze/-Antworten der anderen erst
  beim Aufdecken.
- Spielstand auf dem Laptop gespeichert (Fortsetzen nach Absturz), Wiederverbinden wie gehabt.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { input: 'write', host: 'none', length: 'normal', cols: 6, joker: true, negative: true, answerSec: 10 },
    teams: [{ id: 'rot', name: 'Die Roten', score: 1200, players: [...] }],
    round: 1,                                   // 1, 2, 'final'
    board: [{ name: 'Tiere', cells: [{ q, a, value: 100, joker: false, done: false }] }],
    turn: 'rot',                                // wer wählt
    phase: 'lobby' | 'board' | 'question' | 'buzzed' | 'wager' | 'final-wager' | 'final-answer' | 'final-reveal' | 'end',
    current: { col: 0, row: 2, locked: ['blau'], buzzedBy: null, buzzWindow: [] },
    final: { category, q, a, wagers: {}, answers: {} },
    history: [ … ]
  }
  ```

### Tests

- Wand: 6×5 Felder, Joker nicht in Reihe 1, Runde 2 doppelte Werte, keine Wiederholung über Spiele
- Buzzer: kleinste Reaktionszeit gewinnt, Frühstarter-Sperre, gesperrte Teams nach Falschantwort
- Punkte: ±Wert, ohne Minuspunkte, Joker-Einsatzgrenzen (auch bei 0 / negativem Stand)
- Finale: nur Teams > 0, Einsatz ≤ Stand, Aufdecken vom letzten Platz
- Gefilterte Ansicht verrät keine Antworten / fremden Einsätze
- Katalog: jede Kategorie 5 Fragen, keine doppelten Fragen, jede Frage hat eine Antwort
- Eigene Wand: Export → Import → Link ergibt dieselbe Wand

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                                     | Ergebnis                          |
| ------ | ------------------------------------------------------------------------------------------ | --------------------------------- |
| **1**  | Wand, Runden, Punkte, Finale, **ohne Handy** (Tastatur-Buzzer), Katalog mit ~100 Fragen, Karte auf der Startseite | Quizabend mit einem Laptop |
| **2**  | **Mit Handy**: Buzzer mit Reaktionszeit, Einsätze geheim, Quizmaster-Ansicht, Wiederverbinden | Das volle Erlebnis 🔔            |
| **3**  | **Editor** für eigene Wände, Export/Import, Teilen per Link                                 | Eigene Quizze 🎂                  |
| **4**  | Katalog auf 200 + 30 Finalfragen, Umgekehrt-Modus, Bilderfragen, Auszeichnungen, Sounds        | Fertig 🎉                         |

---

## 8. Entscheidungen ✅

1. **Name:** „Who knows more?“, Ordner `who-knows-more/` ✅
2. **Quizmaster:** Standard „ohne“ (alle spielen mit) ✅
3. **Minuspunkte:** standardmäßig an ✅ (aus = nur Felder, Joker & Finale bleiben ±Einsatz)
4. **Fragenkatalog:** Wissen, Popkultur, Alltag, Wortspiele + **Gaming & Internet**, **Schulfächer** und optional **18+** ✅
5. **Antworten:** in den Runden laut, im Finale getippt (mit `match.js`-Vorschlag) ✅
6. **Umgekehrt:** Die Wand zeigt die Antwort, gesucht ist eine passende Frage – entschieden wird sinngemäß ✅

Umgesetzt: alle 4 Etappen.
