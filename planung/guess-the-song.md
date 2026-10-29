# 🎧 Guess the song – Planung

Songs anhand **kurzer Hörbeispiele** erraten: Erst hört man **eine Sekunde**, dann zwei, dann vier … Wer früher
richtig liegt, bekommt mehr Punkte. Bekannt aus Online-Spielen wie *Heardle* und aus der TV-Show
*„Name That Tune“*.

Dazu ein Modus **ganz ohne Audio**: **🎤 Summen** – eine Person bekommt den Titel aufs Handy und **summt** ihn,
die anderen raten. Rechtlich unproblematisch und sehr lustig.

Der **Laptop** ist **Bühne und Lautsprecher**, geraten wird **auf den Handys** (Titel tippen mit Vorschlägen, wie bei
Schlecht erklärt) oder per **Buzzer** (wie bei Who knows more?). Audio und Song-Datenbank siehe
**[musik-grundlagen.md](musik-grundlagen.md)**.

> ✅ **Fertig** in `guess-the-song/` (alle drei Etappen) – Beschreibung im README.

## Überblick

|                         | 🔊 **Ausschnitte**                                     | 🎤 **Summen**                                   |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| Ton                     | iTunes-Ausschnitt vom Laptop, Stück für Stück länger  | eine Person summt (oder singt mit „la la la“)  |
| Raten                   | Handy: tippen oder Buzzer                             | Handy: tippen oder laut                        |
| Wer weiß die Lösung?    | nur der Laptop                                        | die summende Person                            |
| Personen                | 2–12, einzeln/Teams                                   | 3–12, reihum summen                            |

- **10 / 15 / 20 Songs** pro Spiel, Siegerehrung, Stechen bei Gleichstand
- Aufwand: Song-Datenbank (gemeinsam), **Ausschnitt-Steuerung** (genau 1 s abspielen), **Titel-Erkennung** (aus
  Schlecht erklärt nach `shared/titles.js`)

---

## 1. Modus 🔊 Ausschnitte

### Ablauf eines Songs

| Stufe | Hörprobe        | Punkte bei Treffer |
| ----- | --------------- | ------------------ |
| 1     | **1 s**          | 6                  |
| 2     | **2 s**          | 5                  |
| 3     | **4 s**          | 4                  |
| 4     | **8 s**          | 3                  |
| 5     | **16 s**         | 2                  |
| 6     | **30 s** + Hinweis (*Jahrzehnt + Interpret-Anfangsbuchstabe*) | 1 |

- Jede Stufe spielt **von derselben Stelle** ab (vom Anfang des Ausschnitts), nur länger.
- Zwischen den Stufen **10 s Ratezeit**, die Spielleitung kann *„Nochmal hören“* drücken (gleiche Stufe wiederholen).
- **Raten per Tippen:** Titel *oder* Interpret? → **Titel** zählt voll, **nur Interpret** gibt die Hälfte (einstellbar).
  Max. **3 Versuche** pro Song. „Knapp daneben“ (Tippfehler) kostet keinen Versuch – wie bei Schlecht erklärt.
- **Raten per Buzzer:** Wer zuerst drückt, sagt laut, Spielleitung bestätigt ✅/❌. Falsch → für diesen Song raus.
  Buzzer-Fairness wie bei Who knows more? (Zeitstempel auf dem Laptop).
- **Schnellster** bekommt +1.

### Wo im Song?

iTunes-Ausschnitte sind meist ein Stück aus der **Mitte/dem Refrain** – gut für „leicht“. Für „schwer“: Startpunkt
innerhalb des Ausschnitts zufällig (nicht der Refrain). Echte Song-Intros gibt es nur bei *„Selbst abspielen“*.

---

## 2. Modus 🎤 Summen

1. Reihum ist eine Person **Summer/in**. Ihr Handy zeigt **3 Songs** zur Auswahl (Stufe nach Einstellung) + *„Kenn ich nicht“*.
2. Sie summt (ohne Worte!) – **60 s**.
3. Die anderen tippen (oder rufen). Punkte: **3** für den ersten Treffer, **1** für alle weiteren.
   Die **Summer/in bekommt 2**, wenn mindestens eine Person es erraten hat.
4. Varianten: **🗣️ Pfeifen**, **🥁 Klopfen** (nur Rhythmus, sehr schwer), **🙊 Pantomime** zum Song.

---

## 3. Einstellungen

| Option              | Werte                                        | Standard    |
| ------------------- | -------------------------------------------- | ----------- |
| Modus               | Ausschnitte / Summen / abwechselnd           | Ausschnitte |
| Raten               | tippen / Buzzer                              | tippen      |
| Anzahl Songs        | 10 / 15 / 20                                 | 15          |
| Stufen              | 1-2-4-8-16-30 / 2-5-10-30 (leichter)          | 1-2-4-8-16-30 |
| Interpret zählt     | halb / voll / nein                           | halb        |
| Startstelle         | Refrain (leicht) / zufällig (schwer)          | Refrain     |
| Jahrzehnte, Kategorien | Mehrfachauswahl                           | alle        |
| Teams               | aus / 2–4                                    | aus         |
| 🍻 Trinkregeln       | niemand erkennt den Song → alle 1, Treffer nach 1 s → 3 verteilen | aus |

---

## 4. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🎧 Guess the song · Song 4/15                         Anna 18 · Ben 12 …  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│     ▮ ▮ ▮▮ ▮▮▮▮ ▯▯▯▯▯▯▯▯ ▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯                                │
│     1s 2s  4s    8s        16s                                           │
│                                                                          │
│         🔊  Stufe 3 · 4 Sekunden · jetzt 4 Punkte                         │
│                                                                          │
│     Anna ✅ (+6, nach 1 s!)   Ben ❌   Cem …   Dora …                       │
│     [ 🔁 Nochmal ]  [ ⏭️ Nächste Stufe ]                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Auflösung:** Cover-Bild (aus der iTunes-Antwort `artworkUrl100`), Titel, Interpret, Jahr, der Song läuft 30 s weiter,
Store-Link. *„Anna hatte es nach 1 Sekunde 🤯“*.

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 🎧 Song 4 · Stufe 3       │  │ 🎤 Du summst!             │  │ 🎧 Buzzer                │
│                         │  │ Such dir einen aus:     │  │                         │
│ [ Bohemi_          ]    │  │ [ Atemlos – H. Fischer ] │  │      ┌───────────┐       │
│  › Bohemian Rhapsody    │  │ [ Africa – Toto        ] │  │      │           │       │
│  › Bohemian Like You    │  │ [ Wonderwall – Oasis   ] │  │      │   BUZZ!   │       │
│                         │  │ [ Kenn ich nicht ↻ ]     │  │      │           │       │
│ Versuche: ● ○ ○          │  │ ⏱ 60 s · nur summen!     │  │      └───────────┘       │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „⚡ Eine Sekunde reicht“ (schnellster Treffer), „🎤 Summ-Star“ (meiste erratene Summ-Songs),
„🙉 Taub“ (meiste falsche Versuche), Playlist des Abends.

---

## 5. Technische Umsetzung

### Ordner

```
guess-the-song/  (oder musikabend/ mit Modus „song“)
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/snippet.js                 Ausschnitt laden (AudioSource), genau N Sekunden ab Startstelle abspielen (Web Audio)
  js/engine.js                  Songs, Stufen, Versuche, Buzzer, Summen reihum, Punkte, Ansichten
  js/controllers.js             GameRoom.create({ game: 'guess-the-song', net: 'guessthesong-v1-', storage: 'guessthesong', engine })
  js/app.js
shared/songs/*, shared/songs.js, shared/titles.js, shared/audio-source.js
tests/guess-the-song.test.js
```

### Architektur

- **Genaue Länge:** Ausschnitt einmal als `AudioBuffer` laden (`fetch` → `decodeAudioData`) und mit
  `source.start(0, offset, duration)` abspielen – nur so sind „1 Sekunde“ wirklich 1 Sekunde. Falls `fetch` an CORS
  scheitert: `<audio>`-Element mit `currentTime` + Stopp per Timer (ungenauer, ±0,1 s) als Ausweg.
- Handys schicken `join`, `guess`, `buzz`, `pick` (Summen: Song wählen), `judge` / `replay` / `stage` (Spielleitung), `next`.
- **`viewFor(pid)`**: Song-Daten nie vor der Auflösung – außer an die **Summer/in** im Summ-Modus.
- Die **Vorschläge beim Tippen** kommen aus der Titelliste der gesamten Datenbank (wie bei Schlecht erklärt).

### Tests

- Punkte je Stufe, Interpret halb, Schnellster-Bonus einmal, 3 Versuche, „knapp daneben“ kostenlos
- Titel-Erkennung: *„feat.“*, Klammerzusätze, Interpret allein, Tippfehler
- Buzzer: Reihenfolge nach Zeitstempel, falsch → raus für diesen Song
- Summen: reihum, Summer/in bekommt nur Punkte bei mind. einem Treffer, kann nicht selbst raten
- **Gefilterte Ansicht**

---

## 6. Umsetzung in Etappen

| Etappe | Inhalt                                                                    | Ergebnis              |
| ------ | ------------------------------------------------------------------------- | --------------------- |
| **1**  | **Summen-Modus** mit Song-Datenbank (200 Songs) + Handys, Karte auf der Startseite | Spielbar ohne Audio 🎤 |
| **2**  | `snippet.js` + `AudioSource.itunes`, Stufen, Tippen mit Vorschlägen         | Ausschnitte 🔊          |
| **3**  | Buzzer, Teams, Statistik, Playlist, schwere Startstelle, Varianten (Pfeifen, Klopfen) | Fertig 🎉 |

## 7. Offene Entscheidungen

Siehe [musik-grundlagen.md](musik-grundlagen.md). Außerdem:

1. ~~Standard **tippen** oder **Buzzer**?~~ → **tippen** (Buzzer einstellbar).
2. ~~Zählt der **Interpret allein** (halbe Punkte)?~~ → **halb** (einstellbar: voll / nein). Danach darf weiter nach dem
   Titel geraten werden, es zählt das Bessere.
3. ~~Buzzer im Ausschnitt-Modus: wer bestätigt?~~ → laut sagen, der **Laptop** (oder die Spielleitung, nicht fürs eigene Team)
   bestätigt. Die Lösung lässt sich am Laptop aufdecken – dann ist der Song nach der Entscheidung für alle vorbei.
4. ~~Auch mit einem Gerät?~~ → **ja**: alle rufen, am Laptop wird angetippt, wer zuerst gerufen hat (Tasten 1–9).
   Beim Summen schaut die Summer/in kurz allein auf den Laptop.
