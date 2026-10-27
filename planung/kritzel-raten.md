# ✏️ Kritzel-Raten – Planung

Unsere Version von **skribbl.io** (und dem Klassiker *Montagsmaler*): Eine Person **zeichnet** auf dem Handy einen
Begriff, das Bild erscheint **live auf dem Laptop**, und alle anderen **tippen** ihre Tipps ins Handy. Wer schneller
richtig liegt, bekommt mehr Punkte. Falsche Tipps laufen wie in einem **Chat** über die Bühne – das ist die halbe
Unterhaltung.

Unterschied zu **Guess the word!** (Kategorie Zeichnen): Dort wird laut geraten und Punkte vergibt man von Hand. Hier
prüft die App die Tipps automatisch, es gibt **Tempo-Punkte**, **Buchstaben-Hinweise** und den Chat.

> Name: **Skribbl** (Arbeitstitel war *Kritzel-Raten*), Ordner `skribbl/`. ✅ Umgesetzt – siehe Abschnitt 7 und 8.

## Überblick

- **3–12 Personen** einzeln
- **2–3 Runden**: In jeder Runde zeichnet jede Person einmal
- Gerät: **Laptop + Handys** (Pflicht)
- Aufwand gering bis mittel: **Zeichenfläche gibt es** (`guess-the-word/js/sketch.js` → `shared/sketch.js`,
  zusammen mit Stille Post), **Begriffe gibt es** (`guess-the-word/js/words/zeichnen.js`), Prüfung über
  `shared/match.js`. Neu sind Live-Übertragung, Chat und Tempo-Punkte.

---

## 1. Ablauf eines Zuges

1. **Wort wählen:** Die zeichnende Person bekommt **3 Begriffe** (leicht/mittel/schwer) und wählt einen (10 s,
   sonst zufällig).
2. **Zeichnen:** **80 s** (einstellbar). Keine Buchstaben, keine Zahlen, keine Zeichen-Sprache (*„Ohr“ + Pfeil*) –
   wie im Original darf man das **nicht**, kann es aber technisch nicht verhindern; die Runde passt auf.
3. **Raten:** Alle anderen tippen **so oft sie wollen**.
   - **Richtig** → ✅, man sieht ab jetzt das Wort, die Bühne zeigt *„Anna hat es! ⚡“* (ohne das Wort)
   - **Fast richtig** (1 Tippfehler, über `shared/match.js`) → nur man selbst sieht *„Knapp daneben!“*
   - **Falsch** → erscheint im **Chat** auf der Bühne (*„Ben: Kuh?“*)
4. **Hinweise:** Auf der Bühne steht das Wort als Lücken (*„_ _ _ _ _ _“* mit Wortlänge). Nach 50 % und 75 % der Zeit
   wird je **ein Buchstabe** aufgedeckt (bei kurzen Wörtern nur einer).
5. **Ende:** wenn alle es haben oder die Zeit um ist. Wort wird gezeigt, Punkte.

### Punkte

| Wer                      | Punkte                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| Ratende                  | **Rest-Zeit-Anteil × 100 + 50** (je schneller, desto mehr), Erste/r +50 Bonus |
| Zeichnende Person        | **Durchschnitt der Ratenden-Punkte × Anteil der Treffer** (alle haben es → viel, niemand → 0) |

So lohnt sich klares, schnelles Zeichnen – und zu schwere Wörter tun der zeichnenden Person weh.

### Melden

Zeichnet jemand Buchstaben oder etwas Unpassendes, können die Ratenden **🚩 melden**. Bei Mehrheit wird der Zug
abgebrochen, die zeichnende Person bekommt 0.

---

## 2. Begriffe

- Grundlage: **`guess-the-word/js/words/zeichnen.js`** (vorhanden) – wird nach Stufe sortiert
- Zusätzliche Pakete in `js/woerter/`: *Tiere, Essen, Berufe, Filme & Serien, Gegenstände, Orte, Aktionen (Verben)*,
  je ~150, Stufe 1–3
- **Eigene Wörter:** Spielleitung kann vor dem Spiel eine Liste eintippen (*„nur unsere Insider“*) – Option „nur eigene“
  oder „gemischt“
- **Mehrwort-Begriffe** (*„Eiffelturm“* ✓, *„Mann im Mond“* ✓) – Lücken zeigen Leerzeichen
- Antworten zählen auch mit Artikel/Plural (*„die Kühe“* für *Kuh*), dafür `same()` aus `match.js`

---

## 3. Zeichnen & Live-Übertragung ✏️

- Werkzeuge wie bei Stille Post: **Farben**, **3 Stärken**, **Radierer**, **Füllen** (Farbeimer – auf Canvas mit
  Flood-Fill, gibt es bei skribbl und ist beliebt), **Rückgängig**, **Löschen**.
- **Live:** Das Handy schickt Striche **während des Zeichnens** in kleinen Paketen (alle ~50 ms die neuen Punkte), die
  Bühne zeichnet sie sofort. `sketch.js` hat schon `pending`/`seq` für genau so etwas.
- **Hochformat** auf dem Handy, Fläche 4:3 oben, Werkzeuge unten. Die Bühne zeigt die Fläche groß, rechts den Chat.
- **Zeichnen am Laptop** als Option (Maus/Touchscreen) – dann zeichnet die Person am Laptop und alle raten auf den Handys.

---

## 4. Einstellungen

| Option             | Werte                                    | Standard   |
| ------------------ | ---------------------------------------- | ---------- |
| Runden             | 1 / 2 / 3                                 | 2          |
| Zeichenzeit        | 60 / 80 / 100 / 120 s                     | 80 s       |
| Wortwahl           | 3 zur Auswahl / zufällig                  | 3 zur Auswahl |
| Hinweis-Buchstaben | 0 / 1 / 2                                 | 2          |
| Wörter             | Standard / Pakete / nur eigene / gemischt | Standard   |
| Chat zeigen        | an / aus                                  | an         |
| Zeichnen auf       | Handy / Laptop                            | Handy      |
| 🍻 Trinkregeln      | niemand errät → Zeichner/in 2 Schlucke; Letzte/r, der es errät → 1 | aus |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✏️ Kritzel-Raten · Runde 1/2 · Ben zeichnet           ⏱ 0:43              │
├────────────────────────────────────────────────┬─────────────────────────┤
│                                                │ 💬                       │
│                                                │ Cem: Hund?               │
│          (Zeichnung entsteht live)             │ Dora: Pferd              │
│                                                │ ⚡ Anna hat es!           │
│                                                │ Eli: Esel?               │
│                                                │ Finn: Kuh                │
├────────────────────────────────────────────────┤ ✅ Cem hat es!           │
│              _ _ _ _ A _ _      (7)            │                         │
├────────────────────────────────────────────────┴─────────────────────────┤
│  Anna 340 ✅  Ben ✏️ 210  Cem 290 ✅  Dora 120  Eli 80  Finn 150             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ ✏️ Wähle ein Wort  ⏱ 8 s  │  │ ✏️ Zeichne: GIRAFFE ⏱ 43 │  │ ✏️ Ben zeichnet  ⏱ 43 s   │
│                         │  │ ┌─────────────────────┐ │  │  _ _ _ _ A _ _           │
│ [ Haus      ] leicht    │  │ │                     │ │  │                         │
│ [ Giraffe   ] mittel    │  │ │                     │ │  │ (kleine Live-Vorschau)  │
│ [ Zahnfee   ] schwer    │  │ └─────────────────────┘ │  │                         │
│                         │  │ ●●●●●● ─ ━ ▬ 🪣 🧽 ↶ 🗑    │  │ [ Tipp …        ] [→]   │
│                         │  │ ✅ 2 von 5 haben es       │  │ Knapp daneben! 🤏         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „🎨 Picasso“ (zeichnende Person mit den meisten Treffern), „⚡ Adlerauge“ (schnellster Treffer),
„🙈 Rätselhaft“ (Zeichnung, die niemand erkannt hat – wird noch mal gezeigt), **Galerie** aller Zeichnungen.

---

## 6. Technische Umsetzung

### Ordner

```
kritzel-raten/                  → https://tbnsuperkid.github.io/kritzel-raten/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/woerter/*.js               zusätzliche Pakete (+ Adapter für guess-the-word/js/words/zeichnen.js)
  js/hints.js                   Lücken, Buchstaben aufdecken (zufällig, nie zwei nebeneinander am Anfang)
  js/fill.js                    Farbeimer (Flood-Fill auf dem Canvas)
  js/engine.js                  Reihum zeichnen, Wortwahl, Tipps prüfen, Chat, Punkte, Melden, Ansichten
  js/controllers.js             GameRoom.create({ game: 'kritzel-raten', net: 'kritzel-v1-', storage: 'kritzel', engine })
  js/app.js
shared/sketch.js                (gemeinsam mit Stille Post, aus Guess the word! ausgelagert)
tests/kritzel-raten.test.js
```

### Architektur

- Handys schicken `join`, `choose`, `stroke` (Pakete neuer Punkte), `undo`, `clear`, `fill`, `guess`, `report`, `next`.
- **Striche laufen nicht über `view`**, sondern als eigene, schnelle Nachrichten Handy → Laptop → alle Handys
  (Vorschau). Der Spielzustand enthält nur einen Zähler.
- **`viewFor(pid)`**: Wort nur für die zeichnende Person und alle, die es schon erraten haben. Chat-Einträge von
  Personen, die es **schon haben**, sieht nur, wer es auch schon hat (sonst verraten sie es) – wie bei skribbl.
- Die **Prüfung** läuft nur auf dem Laptop.

### Tests

- Prüfung: richtig, Artikel/Plural, Tippfehler → „knapp“, Mehrwort-Begriffe, Groß/klein
- Punkte: Tempo-Formel, Erste/r-Bonus, zeichnende Person nach Anteil, niemand → 0
- Hinweise: Anzahl, Zeitpunkte, Leerzeichen bleiben sichtbar
- Reihum: jede/r zeichnet einmal pro Runde, Abgemeldete werden übersprungen
- Melden: Mehrheit bricht ab
- **Gefilterte Ansicht:** Wort und „Insider-Chat“ nur für die Richtigen

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                     | Ergebnis          |
| ------ | -------------------------------------------------------------------------- | ----------------- |
| **1** ✅ | `shared/sketch.js` auslagern (gemeinsam mit Stille Post) + Live-Übertragung  | Zeichnen live ✏️   |
| **2** ✅ | Engine + Handys: Wortwahl, Raten, Chat, Hinweise, Punkte, Karte auf der Startseite | Spielbar 🎨 |
| **3** ✅ | Farbeimer, Melden, eigene Wörter, Pakete, Galerie, Statistik, Sounds         | Fertig 🎉          |

## 8. Entscheidungen

**Entschieden:** Name **Skribbl**, eigenes Spiel (kein Modus in Guess the word! – dort wird laut geraten, hier prüft die App).

**Umsetzung im Detail:**
- **Ordner** `skribbl/` statt `kritzel-raten/`; PeerJS-Präfix `skribbl-v1-`, Speicher-Präfix `skribbl`.
- **Prüfung** (`js/words.js`): richtig = gleich, Artikel, Plural (auch mit Umlaut: *Kühe* für *Kuh*), *ae* statt *ä*,
  Leerzeichen/Bindestriche egal. Andersherum (Begriff steht im Plural, getippt wird die Einzahl) erst ab 4 Buchstaben und
  ohne „-s“, sonst wäre *Mau* richtig für *Maus*. Knapp = 1 Tippfehler (ab 4 Buchstaben), ab 9 Buchstaben 2.
  `shared/match.js` (`same()`) zählt Tippfehler schon als gleich – deshalb eine eigene Prüfung auf dessen Bausteinen.
- **Knappe Tipps** erscheinen nicht im Chat der anderen (sonst wäre das Wort fast verraten) – nur die tippende Person sieht sie.
- **Melden:** Mehrheit = mehr als die Hälfte der Ratenden des Zugs (wer es schon hat, darf nicht melden, zählt aber mit).
  Die Ratenden behalten ihre Punkte, die zeichnende Person bekommt 0.
- **Striche:** Rückgängig, Löschen und Farbeimer laufen als Teil des Strich-Stroms (`{k:'u'|'clear'|'f'}`), nicht als
  eigene Aktionen. Der Farbeimer wird auf jedem Gerät in dessen Auflösung neu gefüllt (`js/fill.js`, Toleranz + 1 Pixel Rand).
- **Auflösung** läuft nach 8 s automatisch weiter (Laptop: „Weiter →“). Wer mitten im Spiel beitritt, rät sofort mit und
  zeichnet in der laufenden Runde noch, wenn die Reihe nicht schon vorbei ist.
- **Getrennte Handys:** 15 s Schonfrist (wie bei den anderen Spielen). Ist die zeichnende Person länger weg, endet ihr Zug ohne Punkte.
- **Wortpakete:** 7 Pakete mit je rund 115 Begriffen (statt ~150), Stufe 1–3; dazu *Standard* = Zeichnen-Begriffe aus
  Guess the word! ohne Sprichwörter mit mehr als 3 Wörtern. Eigene Wörter: gemischt (zählen als „mittel“) oder *nur eigene*.
- **Galerie** nur am Laptop (die Handys müssten sonst alle Zeichnungen laden).

**Stand:** Alle Tests grün (`tests/skribbl.test.js`, 36 Tests). Im Browser durchgespielt (stumm, Laptop + 3 Handys über den
Node-Server): Wortwahl, Zeichnen mit Farbeimer live auf allen Geräten, falsch / knapp / richtig / Insider-Chat, Auflösung,
Neuladen von Laptop und Handy mitten im Zug, Melden, Zug überspringen, eigene Wörter, Zeichnen am Laptop, Spielende mit Galerie.
