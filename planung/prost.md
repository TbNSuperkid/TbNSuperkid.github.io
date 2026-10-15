# 🍻 Prost! – Planung

> ✅ **Umgesetzt** (alle Etappen inkl. Handys) – siehe `prost/` und README. Abweichungen vom ursprünglichen Plan sind unten markiert.

Das Trinkspiel als Kartenstapel: Eine Karte nach der anderen, mit den **Namen der Mitspielenden** eingesetzt –
*„Anna verteilt 3 Schlucke“*, *„Alle, die schon mal einen Flug verpasst haben, trinken“*, *„Neue Regel: Ben ist
Fragenmeister:in …“*. Ein Gerät liegt in der Mitte oder wird herumgereicht, **Tippen = nächste Karte**.

> **Wichtig:** Das Spiel ist ab 18. Beim Start ein kurzer Hinweis: *Niemand muss trinken, Wasser zählt auch.*
> ~~Es gibt einen alkoholfreien Modus~~ – **gestrichen** (Entscheidung): Es gibt nur Schlucke.

## Überblick

|                         | 📲 **Ein Gerät** (Standard)                       | 📱 **Mit Handys** (optional)                      |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Karten anzeigen**      | Gerät in der Mitte / Laptop / Fernseher           | wie links                                        |
| **„Wer würde eher …“**   | Countdown, alle zeigen gleichzeitig auf jemanden  | **anonyme Abstimmung** auf dem Handy              |
| **„Ich hab noch nie …“** | ehrlich trinken                                   | anonym „hab ich schon“ tippen, Laptop zeigt nur die Anzahl |

- **2–20 Personen**, einzeln (keine Teams)
- Spieldauer über die **Anzahl Karten** (kurz 30 / normal 50 / lang 80 / endlos)
- Personen können **mitten im Spiel** dazu- oder weggenommen werden

---

## 1. Kartentypen

| Typ                     | Beispiel                                                                       | Besonderheit                       |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| **🎯 Aufgabe**           | *{p1} verteilt {s3}.* · *{p1} und {p2} tauschen die Plätze.*                    | 1–2 Namen werden eingesetzt        |
| **🙋 Alle, die …**       | *Alle, die heute noch nichts gegessen haben, trinken {s2}.*                     | –                                  |
| **🙅 Ich hab noch nie**  | *Ich hab noch nie … einen Liebesbrief geschrieben.*                             | Wer schon mal, trinkt {s1}         |
| **🗳️ Wer würde eher**    | *Wer würde eher bei einer Quizshow mitmachen?* → Countdown, zeigen              | Meiste Stimmen trinkt {s2}         |
| **⚔️ Duell**             | *{p1} gegen {p2}: Schere, Stein, Papier. Verlierer:in trinkt {s2}.*             | –                                  |
| **🔁 Kategorie**         | *Nennt reihum Automarken. {p1} fängt an. Wer nichts weiß, trinkt {s2}.*         | –                                  |
| **📜 Regel**             | *Neue Regel: Niemand darf „ja“ oder „nein“ sagen. Wer’s tut, trinkt {s1}.*      | gilt bis zur **Regel-Ende-Karte**  |
| **🦠 Virus**             | *{p1} darf nur noch mit der linken Hand trinken.*                               | gilt bis zur **Virus-Ende-Karte**  |
| **🎲 Wahrheit**          | *{p1}: Was war dein peinlichster Moment in der Schule? Oder {s3}.*             | –                                  |
| **💧 Pause**             | *Wasserpause! Alle trinken 3 Schlucke Wasser.*                                  | ca. alle 15 Karten, abschaltbar    |

**Regel/Virus-Ende:** Eine Regel-Karte plant ihre Ende-Karte **5–15 Karten später** fest ein
(*„Die Regel ‚kein Ja und Nein‘ ist aufgehoben.“*). Bei Spielende werden offene Regeln angezeigt und beendet.

### Platzhalter

| Platzhalter | Wird zu                                                           |
| ----------- | ----------------------------------------------------------------- |
| `{p1}`, `{p2}` | Namen, fair verteilt (wer selten dran war, kommt eher)         |
| `{s1}` … `{s5}` | *1 Schluck* / *3 Schlucke* – mal **Intensität** (leicht ×0,5 · normal ×1 · heftig ×1,5, gerundet, mind. 1) |
| `{exen}`    | *exen*                                                            |
| `{p3}`      | dritter Name (Karte wird übersprungen, wenn nur 2 spielen)        |
| `{c1}`, `{c2}` | die beiden Personen eines Paares (nur Pärchen-Set)             |

Karten sind **geschlechtsneutral** formuliert (*Verlierer:in*, *wer …*), damit jeder Name passt.

---

## 2. Kartensets

| Set              | Inhalt                                                | Standard |
| ---------------- | ----------------------------------------------------- | -------- |
| **🌱 Warm-up**    | harmlos, zum Reinkommen                               | an       |
| **🎉 Party**      | der Hauptteil, alle Typen                             | an       |
| **🔥 Heftig**     | mehr Schlucke, mehr Wahrheit, frechere Fragen         | aus      |
| **💕 Pärchen**    | Fragen für Paare in der Runde (Paare werden eingetragen) | aus   |
| **🔞 18+**        | eindeutige Fragen und Aufgaben rund um Sex             | aus      |

- **494 eigene Karten** (Warm-up 63, Party 212, Heftig 84, Pärchen 48, 18+ 87).
- Bei `nie` und `eher` steht in der Liste nur der Rest des Satzes – „Ich hab noch nie …“ bzw. „Wer würde eher …?“ setzt das Spiel davor.
- Ein Spiel startet mit Warm-up-Karten und wird dann zufällig gemischt.
- Bereits gezogene Karten werden gemerkt (`localStorage`) → beim nächsten Abend erst neue Karten.

Format (`js/cards/party.js`), eine Zeile pro Karte:

```
Typ|Text|Ende-Text (nur Regel/Virus)
aufgabe|{p1} verteilt {s3}.
alle|Alle, die schon mal einen Flug verpasst haben, trinken {s2}.
regel|Neue Regel: Niemand darf „ja“ oder „nein“ sagen. Wer’s tut, trinkt {s1}.|Ihr dürft wieder „ja“ und „nein“ sagen.
```

---

## 3. Einstellungen

| Option          | Werte                                      | Standard      |
| --------------- | ------------------------------------------ | ------------- |
| Mitspielende    | Namen (2–20), optional Paare               | –             |
| Spieldauer      | 30 / 50 / 80 Karten / endlos               | 50            |
| Kartensets      | Auswahl (siehe oben)                       | Warm-up + Party |
| Intensität      | leicht / normal / heftig                   | normal        |
| Handys          | aus / an (anonyme Abstimmungen)            | aus           |
| Wasserpausen    | an / aus (3 Schlucke Wasser)               | an            |

---

## 4. Bildschirme

```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│ 🍻 Wer spielt mit?       │   │ 12 / 50          ⚙️  ✕   │   │ 13 / 50          ⚙️  ✕   │
│                         │   │                         │   │                         │
│  Anna             ✕     │   │        📜 REGEL         │   │     🗳️ WER WÜRDE EHER    │
│  Ben              ✕     │   │                         │   │                         │
│  Cem              ✕     │   │  Niemand darf „ja“ oder │   │  … bei einer Quizshow   │
│  Dora             ✕     │   │  „nein“ sagen. Wer’s    │   │      mitmachen?         │
│  [ + Name       ]       │   │  tut, trinkt 1 Schluck. │   │                         │
│                         │   │                         │   │  Auf 3 zeigen alle!     │
│  Sets: 🌱 🎉 ☐🔥 ☐🔞      │   │                         │   │  [ ▶ 3 – 2 – 1 ]         │
│  [   Los geht’s ▶   ]   │   │    Tippen für weiter    │   │  Meiste Stimmen: 2 🍺    │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
        Namen & Sets                   Regel-Karte                Abstimmungskarte
```

- Jeder Kartentyp hat eine **eigene Farbe** und ein Symbol, große Schrift (lesbar auf dem Tisch).
- **Tippen / Leertaste / Wischen** = nächste Karte, **Zurück** möglich (falls jemand zu schnell war).
- Oben ein kleines **📜-Symbol mit Zahl**, das die aktiven Regeln anzeigt (antippen → Liste).
- Laptop/Fernseher: gleiche Ansicht, nur größer.

---

## 5. Technische Umsetzung

### Ordner & Adresse

```
prost/                          → https://tbnsuperkid.github.io/prost/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/cards/warmup.js, party.js, heftig.js, paerchen.js, adult.js
  js/deck.js                    Stapel bauen: Sets mischen, Warm-up zuerst, Regel-Enden einplanen, Pausen
  js/fill.js                    Platzhalter füllen: Namen fair wählen, Schlucke/Alkoholfrei
  js/engine.js                  Spielzustand: Personen, Position, aktive Regeln, Zurück, Abstimmungen
  js/controllers.js             Ein Gerät / Host mit Handys (nur für Abstimmungen)
  js/app.js                     Oberfläche
tests/prost.test.js
```

### Architektur

- **Ein Gerät ist der Normalfall** und läuft komplett offline – kein Raum, kein Netzwerk.
- Mit Handys: Das Kartengerät ist Host, Handys sind nur **Abstimmungs-Fernbedienungen**
  (`vote`, `never-have-i`). Abstimmungen sind anonym: der Host zeigt nur die Summen.
- Der Stapel wird **zu Spielbeginn komplett gebaut** (inkl. eingeplanter Regel-Enden), Namen werden aber
  erst beim Aufdecken eingesetzt – so passen sie auch, wenn jemand dazukommt oder geht.
  Karten mit einem Namen, der nicht mehr da ist, werden neu gefüllt; Regeln/Viren einer gegangenen Person enden.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { length: 50, sets: ['warmup', 'party'], intensity: 'normal', soft: false, phones: false, water: true },
    players: [{ id, name, picked: 3 }],         // picked: wie oft schon eingesetzt (Fairness)
    deck: [{ type: 'regel', text, endAt: 21, id }],
    pos: 12,
    active: [{ id, text, endAt }],              // laufende Regeln/Viren
    shown: [{ text: 'Anna verteilt 3 Schlucke.' }],   // für „Zurück“
    vote: { open: true, counts: {} }
  }
  ```

### Tests

- Platzhalter: alle ersetzt, `{p1}` ≠ `{p2}`, faire Verteilung über 50 Karten, Intensität + Alkoholfrei
- Stapel: Warm-up zuerst, jede Regel hat genau ein Ende danach, keine Regel-Enden nach Spielende,
  Wasserpausen im Abstand, gewählte Sets werden respektiert, keine Wiederholungen
- Personen kommen/gehen: Karten werden neu gefüllt, Viren gegangener Personen enden
- Kartenlisten: gültiger Typ, Regel/Virus mit Ende-Text, nur bekannte Platzhalter, keine Dopplungen

---

## 6. Umsetzung in Etappen

| Etappe | Inhalt                                                                              | Ergebnis                     |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------- |
| **1**  | Namen, Stapel, Platzhalter, alle Kartentypen, Regel-Enden, **Warm-up + Party (~200 Karten)**, Karte auf der Startseite | Spielbar 🍻 |
| **2**  | ~~Alkoholfrei~~, Intensität, Zurück, aktive Regeln, Personen dazu/weg, Wasserpausen   | Rund                         |
| **3**  | Sets Heftig, Pärchen, 18+, Karten auf ~400                                           | Abwechslung                  |
| **4**  | **Handys** für anonyme Abstimmungen, Animationen & Sounds                             | Fertig 🎉                    |

---

## 7. Entscheidungen

1. **Name:** „Prost!“, Ordner `prost/` ✅
2. **Handys:** eingebaut ✅ – als anonyme Abstimmungs-Fernbedienungen, die auch die Karte mitlesen.
   Wer kein Handy hat, wird am Kartengerät eingetragen; ein Handy mit demselben Namen übernimmt die Person.
   „Ich hab noch nie“ zeigt nur die Anzahl – getrunken wird trotzdem ehrlich (*„trinken jetzt auch wirklich alle 3?“*).
3. **18+-Set:** eindeutig ✅
4. **Alkoholfrei:** gestrichen ✅
5. **Wasserpause:** 3 Schlucke Wasser statt einem Glas, per Einstellung an/aus ✅
6. **Paare:** werden beim Spielstart (und im Spiel unter 👥) eingetragen; ohne Paare wird das Pärchen-Set übersprungen ✅
