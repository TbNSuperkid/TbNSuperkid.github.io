# 🖍️ Flüsterpost (Stille Post gezeichnet) – Planung

Unsere Version von **Gartic Phone** (Onrizon) und **Telestrations** (USAopoly): Alle schreiben einen **Satz**. Der
Satz wandert zur nächsten Person, die ihn **zeichnet**. Die Zeichnung wandert weiter, die nächste Person
**beschreibt**, was sie sieht. Dann wird das wieder gezeichnet … Am Ende zeigt der Laptop jede **Kette** von vorne
bis hinten – aus *„Ein Pinguin fährt Ski“* wird über vier Stationen *„Oma bügelt einen Fisch“*.

Kein Gewinnen nötig: Der Spaß ist die **Vorführung am Ende**. Optional gibt es Abstimmungen und Punkte.

Gezeichnet wird auf den **Handys** (`guess-the-word/js/sketch.js` kann das schon: normierte Striche, Übertragung
an andere Geräte). Der Laptop ist die Bühne für Wartezeit und Vorführung.

> Name: **Flüsterpost** (Arbeitstitel war *Stille Post gezeichnet*), Ordner `fluesterpost/`. ✅ Umgesetzt – siehe Abschnitt 7 und 8.

## Überblick

- **4–12 Personen** (mit 3 geht's, wird aber kurz)
- **Alle gleichzeitig:** Jede/r ist in jedem Schritt mit einer anderen Kette beschäftigt
- Anzahl Schritte = Anzahl Personen (jede Kette kommt bei allen einmal vorbei), einstellbar kürzer
- Gerät: **Laptop + Handys** (Pflicht)
- Aufwand: **Weitergabe-Logik** + **Zeichnen auf dem Handy** + **Vorführung**. Inhalte nur optional
  (Startsätze für Ideenlose).

---

## 1. Ablauf

| Schritt          | Was man sieht                       | Was man macht                              | Zeit (Standard) |
| ---------------- | ----------------------------------- | ------------------------------------------ | --------------- |
| **1. Schreiben**  | leeres Feld (+ 🎲 Vorschlag)         | einen Satz ausdenken                       | 45 s            |
| **2. Zeichnen**   | den Satz der vorherigen Person       | ihn zeichnen                               | 90 s            |
| **3. Beschreiben**| die Zeichnung der vorherigen Person  | beschreiben, was man sieht                 | 45 s            |
| **4. Zeichnen**   | die Beschreibung                    | zeichnen                                   | 90 s            |
| …                | abwechselnd                         |                                            |                 |
| **Vorführung**    | Bühne zeigt Kette für Kette          | lachen 😂, optional abstimmen               |                 |

- **Weitergabe:** Im Schritt *k* bearbeitet Person *i* die Kette von Person *(i − k) mod n*. So sieht niemand
  seine eigene Kette, bevor sie fertig ist, und jede Kette landet bei allen genau einmal.
- **Fertig vor der Zeit:** Wer fertig ist, drückt *Fertig*. Sind alle fertig, geht es sofort weiter. Wer nicht fertig wird,
  gibt automatisch ab, was da ist (halbe Zeichnung oder halber Satz).
- **Leer abgegeben:** Bekommt jemand einen leeren Satz, steht dort *„(nichts) – denk dir was aus!“*.

### Vorführung

- Die Bühne zeigt die erste Kette **Schritt für Schritt**: Startsatz → Zeichnung (Striche werden **nachgezeichnet**,
  wie sie entstanden sind – das ist der lustigste Teil) → Beschreibung → …
- Die **Person, deren Kette es ist**, schaltet auf ihrem Handy weiter (oder die Spielleitung).
- Unter jedem Schritt steht, wer ihn gemacht hat.
- Am Ende jeder Kette: **❤️ Lieblingsmoment** antippen (optional).

---

## 2. Modi

| Modus                 | Ablauf                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| **Normal**             | Schreiben → Zeichnen → Beschreiben → …                                      |
| **Wort-Start**         | Startwörter kommen aus der Liste von Guess the word! (`zeichnen.js`) statt selbst geschrieben |
| **Nur Zeichnen** 🔁     | Man sieht eine Zeichnung nur **3 Sekunden** und muss sie **nachzeichnen** – wie Stille Post mit Bildern |
| **Punkte-Modus** 🏆     | Am Ende jeder Kette stimmen alle: *Ist das Ende noch das Gleiche wie der Anfang?* Punkte für jeden Schritt, der „gehalten“ hat (Startsatz ≈ Beschreibung, über `shared/match.js` + Abstimmung) |

---

## 3. Zeichnen auf dem Handy ✏️

- `sketch.js` aus Guess the word! wird nach **`shared/sketch.js`** ausgelagert (wird auch von Kritzel-Raten gebraucht).
- Werkzeuge: **6–8 Farben**, **3 Stiftstärken**, **Radierer**, **Rückgängig**, **Alles löschen** (mit Nachfrage).
- Fläche **4:3**, im Hochformat oben die Aufgabe, darunter die Fläche, ganz unten die Werkzeuge.
- Striche werden mit **Zeitstempel** gespeichert, damit die Vorführung sie in Echtzeit (oder 2× schneller)
  abspielen kann.
- **Größe:** Eine Zeichnung = Liste von Strichen mit normierten Punkten (0..1). Punkte beim Zeichnen ausdünnen
  (nur alle ~2 px), damit eine Zeichnung unter ~50 KB bleibt. Übertragung an den Laptop beim *Fertig*, nicht live.

---

## 4. Einstellungen

| Option              | Werte                                   | Standard |
| ------------------- | --------------------------------------- | -------- |
| Modus               | Normal / Wort-Start / Nur Zeichnen / Punkte | Normal |
| Schritte            | alle (= Personen) / 6 / 8               | alle     |
| Zeit Schreiben      | 30 / 45 / 60 s                          | 45 s     |
| Zeit Zeichnen       | 60 / 90 / 120 s / ohne                  | 90 s     |
| Vorführung          | nachzeichnen / sofort fertig            | nachzeichnen |
| Lieblingsmoment     | an / aus                                | an       |
| Startsätze          | Familie / Ab 18 / eigene                | Familie  |
| 🍻 Trinkregeln       | Kette ist am Ende völlig anders → Startperson trinkt 1 | aus |

---

## 5. Bildschirme

### Laptop – während des Spiels

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🖍️ Stille Post · Schritt 4/8 · Zeichnen                        ⏱ 0:52    │
├──────────────────────────────────────────────────────────────────────────┤
│          Anna ✓   Ben ✏️   Cem ✓   Dora ✏️   Eli ✏️   Finn ✓   …          │
│                                                                          │
│               (keine Inhalte – sonst wäre es ja kein Geheimnis)          │
│               Tipp-Text: „Strichmännchen sind völlig okay!“              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Laptop – Vorführung

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🖍️ Annas Kette (3/8)                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│  ✍️ Anna:   „Ein Pinguin fährt Ski“                                       │
│  🖍️ Ben:    ┌──────────────┐                                              │
│             │  (Zeichnung  │  ← wird gerade Strich für Strich gezeichnet  │
│             │   entsteht)  │                                              │
│             └──────────────┘                                              │
│  💬 Cem:    „Ein Vogel auf einem Surfbrett“                               │
│  …                                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ ✍️ Schreib einen Satz     │  │ 🖍️ Zeichne:   ⏱ 0:52    │  │ 💬 Was ist das?   ⏱ 31 s │
│                         │  │ „Ein Pinguin fährt Ski“  │  │ ┌─────────────────────┐ │
│ [ Ein Pinguin fährt Ski ]│  │ ┌─────────────────────┐ │  │ │     (Zeichnung)     │ │
│                         │  │ │                     │ │  │ └─────────────────────┘ │
│ [ 🎲 Vorschlag ]          │  │ │                     │ │  │ [ Vogel auf Surfbrett ] │
│ [ Fertig ✓ ]             │  │ └─────────────────────┘ │  │ [ Fertig ✓ ]             │
│                         │  │ ●●●●●● ─ ━ ▬ 🧽 ↶ 🗑      │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Ende:** Alle Ketten als **Bild zum Speichern** (eine lange Grafik pro Kette, `canvas.toBlob`) – zum Teilen in der
Gruppe. „❤️ Lieblingsmoment des Abends“ mit den meisten Herzen.

---

## 6. Technische Umsetzung

### Ordner

```
stille-post/                    → https://tbnsuperkid.github.io/stille-post/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/saetze.js                  Startsätze (Familie / Ab 18)
  js/chain.js                   Weitergabe (wer bearbeitet in Schritt k welche Kette), Schrittart (Text/Bild)
  js/replay.js                  Zeichnung mit Zeitstempeln nachzeichnen, Ketten-Bild exportieren
  js/engine.js                  Schritte, Abgaben, Zeit, Vorführung, Herzen, Ansichten
  js/controllers.js             GameRoom.create({ game: 'stille-post', net: 'stillepost-v1-', storage: 'stillepost', engine })
  js/app.js
shared/sketch.js                ausgelagert aus guess-the-word/js/sketch.js
tests/stille-post.test.js
```

### Architektur

- Handys schicken `join`, `submit` ({ step, text } oder { step, strokes }), `draft` (Zwischenstand alle 10 s, damit beim
  Verbindungsabbruch nichts verloren geht), `advance` (Vorführung), `heart`, `next`.
- **`viewFor(pid)`** schickt jeder Person **nur** den vorherigen Schritt der Kette, die sie gerade bearbeitet – nie
  die ganze Kette.
- **Zeichnungen sind groß** – die Ansicht schickt sie nur **einmal** (beim Schrittwechsel), nicht bei jeder Änderung des
  Spielzustands. Der Laptop hält die Bilder getrennt vom kleinen Spielzustand.
- **Fällt eine Person aus**, wird ihr Schritt nach Ablauf der Zeit mit *„(verschollen)“* gefüllt; sie kann wieder
  einsteigen. Neue Personen können **nicht** mitten im Spiel einsteigen (Ketten sind fest).
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { mode: 'normal', steps: 0, writeTime: 45, drawTime: 90, replay: 'animate', hearts: true, deck: 'family' },
    players: [{ id, name, connected }], order: ['p1', 'p2', …],
    step: 4, deadline: 1730000000000,
    chains: { p1: [{ by: 'p1', type: 'text', text: '…' }, { by: 'p2', type: 'draw', ref: 'img:p1:1' }, …] },
    images: { 'img:p1:1': [/* Striche */] },     // nicht im normalen viewFor
    done: ['p1', 'p3'],
    show: { chain: 'p1', step: 2 },
    hearts: { 'p1:2': ['p3', 'p4'] },
    phase: 'lobby' | 'play' | 'show' | 'end'
  }
  ```

### Tests

- Weitergabe für 3–12 Personen: jede Kette bei allen genau einmal, niemand bekommt die eigene Kette, Schrittart wechselt
- Kürzere Schrittzahl, Abgabe bei Zeitablauf, leere Abgabe, ausgefallene Person
- **Gefilterte Ansicht:** jede Person sieht nur den direkten Vorgänger-Schritt
- Nachzeichnen: Reihenfolge und Zeiten der Striche bleiben erhalten, Ausdünnen der Punkte

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                    | Ergebnis          |
| ------ | ------------------------------------------------------------------------- | ----------------- |
| **1** ✅ | `sketch.js` nach `shared/` auslagern (Guess the word! muss unverändert laufen), Zeitstempel, Werkzeuge | Zeichnen passt ✏️ |
| **2** ✅ | `chain.js` + Engine + Handys: Schreiben/Zeichnen/Beschreiben, Weitergabe, Vorführung, Karte auf der Startseite | Spielbar 🖍️ |
| **3** ✅ | Nachzeichnen-Animation, Herzen, Ketten-Bild speichern, Sounds              | Das volle Erlebnis |
| **4** ✅ | Modi Wort-Start, Nur Zeichnen (ohne Punkte-Modus); Startsätze, Trinkregeln | Fertig 🎉          |

## 8. Entscheidungen

**Entschieden:** Name **Flüsterpost**. **Kein Punkte-Modus** – der Spaß ist die Vorführung, dazu ❤️ Herzen.
**Ketten-Bilder zum Speichern: ja, nur am Laptop** (lokal erzeugt, nichts wird hochgeladen; die Handys bekommen keine Bilder).

**Umsetzung im Detail:**
- **Ordner** `fluesterpost/`; PeerJS-Präfix `fluesterpost-v1-`, Speicher-Präfix `fluesterpost`.
- **3–12 Personen** (mit 3 geht's). Schritte: alle / 4 / 6 / 8 (höchstens so viele wie Personen).
- **Farbeimer** ist dabei: `skribbl/js/fill.js` liegt jetzt als `shared/fill.js` (`GameFill`) für beide Zeichenspiele.
  `shared/sketch.js` hat dazu `GameSketch.paint(canvas, ops, fill)` bekommen (Zeichnung ohne Fläche im Dokument malen).
- **Zeitstempel** setzt das Handy (`t` = ms seit Schrittbeginn). Beim *Fertig* wird verdichtet (`js/replay.js`): Rückgängig und
  Löschen angewendet, Punkte auf ~0,004 (≈ 2 px) ausgedünnt, höchstens 10 000 Koordinaten (~60 KB). Der Laptop prüft jede
  Nachricht noch einmal (`cleanOp`) und verdichtet selbst.
- **Zwischenstände** alle 6 s (nur bei Änderung). Bei Zeitablauf gibt das Handy selbst ab; der Laptop wartet danach noch 2,5 s
  und nimmt sonst den Zwischenstand (*⏱* in der Vorführung) – oder leer bzw. *„(verschollen)“* für Getrennte.
- **„Doch noch ändern“** nimmt die Abgabe zurück; sie bleibt als Rückfall stehen.
- **Ohne Zeitlimit beim Zeichnen** + Laptop-Knopf *⏩ Beeilung!* (noch 10 s, nochmal gedrückt: sofort).
- **„Angekommen?“** (für die Trinkregel und die Auszeichnung): Inhaltswörter von Startsatz und letzter Beschreibung über
  `shared/match.js` vergleichen; der Laptop kann es per Klick korrigieren.
- **Herzen:** eins pro Kette und Person, umsetzbar, nicht für Eigenes und nicht fürs Startwort.
- **Nachzeichnen:** doppelt so schnell, Pausen über 1,2 s gekürzt, gesamt 1,5–9 s.
- **Nur Zeichnen:** write → draw → copy … → describe (letzter Schritt). Der Blick (3 s) kommt zur Zeichenzeit dazu; nach dem
  Neuladen gibt es keinen zweiten Blick.
- **Bilder** liegen im Spielzustand (`s.images`), werden aber getrennt gespeichert (eigener Schlüssel, höchstens alle 1,5 s)
  und nie über die Ansicht verschickt. Neu laden geht auf beiden Seiten; der Beitritt wird zusätzlich pro Tab gemerkt.
- **Startsätze:** 126 *Familie*, 77 *Ab 18*, dazu eigene der Runde.

**Stand:** Alle Tests grün (`tests/fluesterpost.test.js`, 28 Tests). Im Browser durchgespielt (stumm, Laptop + 3 bzw. 4 Handys über
den Node-Server): Schreiben mit 🎲 Vorschlag und „Doch noch ändern“, Zeichnen mit Farbeimer, Handy neu laden mitten im Zeichnen,
Beschreiben mit Bild, Vorführung mit Nachzeichnen, Weiterschalten am Handy, Herzen, „Angekommen!“, Spielende mit Lieblingsmoment,
Galerie und Bild-Export; *Nur Zeichnen* mit 3-s-Blick, Laptop neu laden mitten im Spiel (Bilder bleiben), *Beeilung!* mit
Übernahme des Zwischenstands, *Wort-Start* mit neuem Wort.
