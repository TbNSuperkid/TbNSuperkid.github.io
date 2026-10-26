# 🤔 Wer bin ich? – Planung

Zwei Klassiker in einem Spiel:

1. **🧠 Stirn-Modus** (wie *Heads Up!* von Ellen DeGeneres / Warner Bros.): Eine Person hält das **Handy an die Stirn**.
   Darauf steht ein Begriff, den alle anderen sehen. Sie erklären, die Person rät. **Handy nach unten kippen** =
   richtig, **nach oben** = weiter. 60 Sekunden, so viele wie möglich.
2. **🏷️ Klassisch** (Zettel-an-der-Stirn): Jede/r bekommt eine **berühmte Person**, die alle anderen sehen – nur man
   selbst nicht. Reihum stellt man **Ja/Nein-Fragen**, bis man sich selbst errät.

Der Stirn-Modus braucht nur **ein Handy** (die Begriffe gibt's schon aus Guess the word!). Der klassische Modus ist mit
**einem Handy pro Person** am schönsten: Auf jedem Handy stehen die Figuren **aller anderen**.

> Name: **Wer bin ich?**, Ordner `wer-bin-ich/` (Stirn-Modus heißt bei uns *„Stirnraten“*, nicht *Heads Up*).

## Überblick

|                    | 🧠 **Stirnraten**                                       | 🏷️ **Klassisch**                                       |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Geräte             | **ein Handy** (das gerade ratende), optional Laptop für Punkte | **ein Handy pro Person**, Laptop optional       |
| Personen           | 2–20, einzeln oder Teams                               | 3–10                                                   |
| Tempo              | schnell (60 s pro Person)                              | gemütlich (10–30 min)                                  |
| Inhalte            | Begriffe in Kategorien (vorhanden + neue)              | **Figuren**: Promis, Filmfiguren, Tiere …              |

---

## 1. 🧠 Stirnraten

### Ablauf

1. **Kategorie wählen** (*Tiere, Filme, Berufe, Promis, Pantomime …*).
2. Countdown *„Handy an die Stirn!“* – das Handy erkennt, dass es **aufrecht quer** gehalten wird, und startet.
3. Begriff erscheint groß (für die anderen lesbar). Die anderen **erklären** (oder spielen vor, singen – je nach Kategorie).
4. **Kippen:**
   - **Nach unten** (Display zum Boden) → ✅ richtig, grüner Blitz, Ton
   - **Nach oben** (Display zur Decke) → ⏭️ weiter, oranger Blitz
   - Zurück in die Mitte → nächster Begriff
5. Nach **60 s** (einstellbar): Liste aller Begriffe ✅/⏭️, Punkte = Anzahl ✅. Handy geht an die nächste Person/das nächste Team.

**Steuerung ohne Kippen:** Tippen auf linke/rechte Bildschirmhälfte (für Tablets, Laptops oder wenn der Sensor fehlt).

### Varianten

- **Teams** (Standard ab 6 Personen): abwechselnd, Punkte pro Team, 3 Runden
- **Kategorie pro Runde wechseln** (wie bei Activity: erklären / pantomime / summen)
- **Laptop als Anzeigetafel:** Das Handy schickt Punkte und Begriffe über `shared/room.js` an den Laptop, der Rangliste
  und Zeit zeigt – praktisch bei großen Runden.

### Sensor-Technik

- `DeviceOrientationEvent`: Wir nutzen den Winkel **beta/gamma** im Querformat. Schwellen: ±50° = Kippen, ±20° =
  „Mitte“ (Entprellung, damit ein Kippen nicht doppelt zählt).
- **iOS:** braucht `DeviceOrientationEvent.requestPermission()` **nach einem Tipp** und HTTPS (GitHub Pages ✓).
  Der Start-Knopf fragt die Erlaubnis ab, bei Ablehnung → Tipp-Steuerung.
- **Bildschirm wach halten:** `navigator.wakeLock.request('screen')` während der Runde.
- **Querformat:** `screen.orientation.lock('landscape')` geht nur im Vollbild und nicht überall → Hinweis *„Handy quer halten“*
  und Layout, das in beiden Richtungen funktioniert.
- **Vibration** (`navigator.vibrate`) bei ✅ / ⏭️ (auf Android; iPhone ignoriert es).

---

## 2. 🏷️ Klassisch

### Ablauf

1. Alle treten mit dem Handy bei (QR-Code auf dem Laptop oder auf dem Handy der Spielleitung).
2. **Figuren verteilen** – zwei Wege:
   - **App wählt** aus einer Kategorie (*Promis, Film & Serie, Märchen, Tiere, Comics*)
   - **Gegenseitig ausdenken:** Jede/r tippt eine Figur für die **linke Nachbarin** ein (wie mit Zetteln) – das ist meist
     lustiger. Die App prüft nur, dass nichts leer ist.
3. Jedes Handy zeigt eine **Liste aller anderen mit ihren Figuren** – und bei einem selbst: *„❓ Das bist du“*.
4. Reihum (die App zeigt, wer dran ist) stellt man **Ja/Nein-Fragen** (*„Bin ich ein Mensch?“*). Bei **Ja** darf man weiterfragen,
   bei **Nein** ist die nächste Person dran.
5. **Lösen:** *„Bin ich Batman?“* → stimmt es, drückt eine andere Person (oder man selbst nach Bestätigung) **✅ erraten**.
6. Wer zuerst errät, gewinnt; gespielt wird, bis alle (oder alle bis auf eine/n) fertig sind. **Rangliste** nach Zahl der Fragen.

### Hilfen

- **Notizen** auf dem eigenen Handy: *„✔ Mensch, ✔ lebt nicht mehr, ✘ Politiker“* – schnelle Häkchen-Liste
- **Fragen-Zähler** pro Person (für die Rangliste und den Spott)
- **Tipp anfordern** (kostet 3 Fragen): Kategorie der Figur

---

## 3. Inhalte

| Inhalt                       | Quelle                                           | Ziel |
| ---------------------------- | ------------------------------------------------ | ---- |
| Stirnraten: Erklären          | `guess-the-word/js/words/erklaeren.js` (vorhanden) | –    |
| Stirnraten: Pantomime         | `guess-the-word/js/words/pantomime.js` (vorhanden) | –    |
| Stirnraten: neue Kategorien   | `js/stirn/tiere.js`, `filme.js`, `promis.js`, `berufe.js`, `marken.js`, `songs.js` (aus der Song-Datenbank, siehe [musik-grundlagen.md](musik-grundlagen.md)) | je 150 |
| Klassisch: Figuren            | `js/figuren/promis.js`, `film-serie.js`, `maerchen.js`, `comics.js`, `geschichte.js`, `tiere.js` | je 80, Stufe 1–2 |

- Figuren nur **sehr bekannte** (Stufe 1–2), sonst kommt man mit Ja/Nein-Fragen nicht hin
- **Lebende Promis:** nur Namen, keine Fotos, keine abwertenden Beschreibungen

---

## 4. Einstellungen

| Option                | Werte                                     | Standard     |
| --------------------- | ----------------------------------------- | ------------ |
| Modus                 | Stirnraten / Klassisch                    | Stirnraten   |
| Stirnraten: Zeit      | 30 / 60 / 90 s                            | 60 s         |
| Stirnraten: Steuerung | Kippen / Tippen                           | Kippen       |
| Stirnraten: Teams     | aus / 2–4                                 | aus          |
| Klassisch: Figuren    | App wählt (Kategorie) / gegenseitig ausdenken | gegenseitig |
| Klassisch: Ja = weiterfragen | an / aus (immer nur eine Frage)    | an           |
| 🍻 Trinkregeln         | Stirnraten: 0 Punkte → 2 Schlucke; Klassisch: pro 10 Fragen 1 Schluck | aus |

---

## 5. Bildschirme

```
┌──────────────────────────────────────┐   ┌─────────────────────────┐
│ ⏱ 0:42                     ✅ 5  ⏭️ 2 │   │ 🏷️ Wer bin ich?          │
│                                      │   │                         │
│            GIRAFFE                   │   │ Anna     Pippi Langstr. │
│                                      │   │ Ben      Darth Vader    │
│     ↓ kippen = richtig               │   │ Du       ❓              │
│     ↑ kippen = weiter                │   │ Dora     Angela Merkel  │
└──────────────────────────────────────┘   │ ▶ Ben ist dran (Frage 4) │
          Stirnraten (quer)                │ [ 📝 Notizen ] [ ✅ ]     │
                                           └─────────────────────────┘
                                                 Klassisch
```

---

## 6. Technische Umsetzung

### Ordner

```
wer-bin-ich/                    → https://tbnsuperkid.github.io/wer-bin-ich/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/stirn/*.js, js/figuren/*.js   Inhalte (+ Adapter für die Guess-the-word!-Listen)
  js/tilt.js                    Sensor: Erlaubnis, Kalibrierung, Kippen erkennen, Entprellen, Tipp-Ersatz
  js/heads.js                   Stirnraten: Runde, Zeit, Liste, Teams (läuft offline auf einem Gerät)
  js/engine.js                  Klassisch: Figuren verteilen/ausdenken, Reihum, Erraten, Rangliste, Ansichten
  js/controllers.js             GameRoom.create({ game: 'wer-bin-ich', net: 'werbinich-v1-', storage: 'werbinich', engine })
  js/app.js
tests/wer-bin-ich.test.js
```

### Architektur

- **Stirnraten** läuft **komplett auf einem Gerät** ohne Netzwerk. Optional verbindet es sich als Client mit einem
  Laptop (Anzeigetafel).
- **Klassisch:** `viewFor(pid)` schickt jeder Person **alle Figuren außer der eigenen**. Beim *Gegenseitig ausdenken*
  sieht man nur die Figur, die man selbst vergibt.
- Handys schicken `join`, `assign` (Figur für Nachbar/in), `turn` (Ja/Nein → weiter), `solve`, `confirm`, `hint`.

### Tests

- Kippen: Schwellen, Entprellen (ein Kippen = ein Ereignis), Rückkehr zur Mitte nötig
- Stirnraten: Zeit, Zählung, kein Begriff doppelt pro Abend, Teams reihum
- Klassisch: Zuordnung im Kreis (niemand bekommt die eigene), Reihum, Erraten, Rangliste, Tipp kostet 3 Fragen
- **Gefilterte Ansicht:** eigene Figur ist nie in der eigenen Ansicht

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                    | Ergebnis        |
| ------ | ------------------------------------------------------------------------- | --------------- |
| **1**  | Stirnraten mit Tippen + vorhandenen Begriffen, Karte auf der Startseite     | Sofort spielbar 🤔 |
| **2**  | `tilt.js` (Kippen, iOS-Erlaubnis, Wake Lock), neue Kategorien, Teams        | Stirnraten fertig 🧠 |
| **3**  | Klassisch mit Handys: Figuren, Reihum, Notizen, Rangliste                  | Fertig 🎉        |

## 8. Offene Entscheidungen

1. Beide Modi in einem Spiel oder zwei Karten auf der Startseite?
2. Klassisch: Figuren standardmäßig **gegenseitig ausdenken** oder **App wählt**?
