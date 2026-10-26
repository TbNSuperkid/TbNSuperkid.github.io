# 📡 Wellenlänge – Planung

Unsere Version von **Wavelength** (Wolfgang Warsch, Alex Hague, Justin Vickers, 2019): Auf dem Bildschirm liegt eine
**Skala** zwischen zwei Gegensätzen, z. B. **kalt ↔ heiß**. Eine Person sieht geheim, wo auf der Skala das
**Ziel** liegt, und gibt einen Hinweis – *„Kaffee“*. Ihr Team diskutiert und dreht den **Zeiger** dorthin, wo es
das Ziel vermutet. Je näher dran, desto mehr Punkte.

Wie bei Pi mal Daumen ist ein **Laptop** (oder Fernseher) die **Bühne**: Er zeigt Skala, Zeiger und Aufdecken.
Gespielt wird **mit Handys** (geheimes Ziel + Zeiger drehen) oder **mit einem Gerät**.

> Name: Arbeitstitel **Wellenlänge**, Ordner `wellenlaenge/` (Alternativen: *Auf einer Welle*, *Gedankenskala*).

## Überblick

|                     | 🖥️ **Ein Gerät**                                        | 📱 **Mit Handys**                                      |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| **Geheimes Ziel**    | *„Nur Anna schauen!“* → Ziel zeigen → verdecken          | nur auf dem Handy der hinweisgebenden Person           |
| **Hinweis**          | laut gesagt                                             | laut gesagt (optional getippt, steht dann auf der Bühne) |
| **Zeiger drehen**    | am Laptop mit Maus/Pfeiltasten                          | Team-Handys: alle sehen den Zeiger live, eine Person dreht ihn |
| **Links/rechts tippen** | Gegnerteam ruft, Klick am Laptop                     | Gegnerteam stimmt per Handy ab                          |

- **4–12 Personen** in **2 Teams**, oder **kooperativ** (alle zusammen, 2–12)
- Gewonnen hat das Team, das zuerst **10 Punkte** hat
- Aufwand: **Skala als Grafik** (Halbkreis, Zeiger, Aufdecken) und **400+ Skalenpaare**

---

## 1. Regeln (wie das Original)

### Ablauf einer Runde

1. **Skala ziehen:** Ein Gegensatzpaar erscheint, z. B. *unterschätzt ↔ überschätzt*. Die hinweisgebende Person
   darf einmal **neu ziehen**.
2. **Ziel:** Die App legt ein zufälliges Ziel auf den Halbkreis (0–180°). Das Ziel ist eine Scheibe mit 5 Streifen:

   ```
           ┌───┬───┬───┬───┬───┐
           │ 2 │ 3 │ 4 │ 3 │ 2 │     jeder Streifen ≈ 7° breit, Ziel insgesamt ≈ 35°
           └───┴───┴───┴───┴───┘
   ```
3. **Hinweis:** Die Person sagt **einen Begriff** (darf auch mehrere Wörter haben), der auf der Skala genau dort
   liegt. Verboten: Zahlen/Prozent, Wörter der Skala selbst, Synonyme der Enden.
4. **Team dreht den Zeiger:** Das eigene Team diskutiert offen und stellt den Zeiger ein. Die hinweisgebende Person
   darf nicht helfen (kein Grinsen!).
5. **Gegnerteam tippt:** Liegt das Ziel **links oder rechts** vom Zeiger? Richtig = **1 Punkt** für das Gegnerteam.
6. **Aufdecken:** Die Abdeckung klappt auf, das eigene Team bekommt **4 / 3 / 2 / 0** Punkte.
7. **Aufholregel:** Wer eine **4** bekommt und trotzdem noch hinten liegt, ist **gleich noch mal** dran.

Danach ist das andere Team dran, die hinweisgebende Person wechselt im Team reihum.

### Spielende

- Erstes Team mit **10 Punkten** gewinnt. Schaffen beide in derselben Runde 10, gewinnt das Team mit mehr Punkten,
  sonst gibt es eine **Stechrunde**.

### Kooperativ (Variante aus der Anleitung)

- Alle sind ein Team, es gibt **7 Skalen**. Kein Links/Rechts-Tipp.
- Punkte zusammenzählen, Wertung am Ende: *0–3 „Funkloch“ · 4–6 „Rauschen“ · 7–9 „Empfang“ · 10–12 „Gleiche Welle“
  · 13+ „Gedankenleser“*. Bei einer 4 gibt es **eine Skala extra**.

---

## 2. Spielweisen

### 🖥️ Ein Gerät

- Teams und Namen eintragen. Laptop zeigt *„🙈 Alle wegschauen – nur Anna!“* → *Zeigen* → Ziel sichtbar →
  *Verdecken*. Danach ist das Ziel nicht mehr abrufbar.
- Zeiger mit **Maus ziehen** oder **← →**, *Fertig* drückt das Team. Dann zwei große Knöpfe **◀ Links | Rechts ▶**
  für das Gegnerteam, danach Aufdecken.

### 📱 Mit Handys

- QR-Code, beitreten mit Namen und **Teamwahl** (wie bei 2 Dumme).
- Die hinweisgebende Person sieht das Ziel auf ihrem Handy (und kann es dort noch einmal anschauen).
- **Zeiger:** Alle im Team sehen den Zeiger auf dem Handy und dürfen ihn verschieben – der Laptop zeigt ihn live.
  So kann jede/r zeigen, was sie/er meint. *„Fertig“* braucht die Zustimmung von 2 Personen (oder der Teamleitung).
- Gegnerteam stimmt per Handy ab, die Mehrheit zählt (bei Gleichstand: rechts).
- Erstes Handy = Spielleitung (Weiter, neue Skala, Pause).

---

## 3. Die Skalen 🎚️ (Kernstück)

**Ziel: 400 Skalenpaare**, eigene Texte (die Original-Karten kopieren wir nicht). Eine Datei pro Kategorie:

| Kategorie         | Datei           | Ziel | Beispiele                                                              |
| ----------------- | --------------- | ---- | ---------------------------------------------------------------------- |
| 🌡️ Klassisch       | `klassisch.js`  | 100  | kalt ↔ heiß · leise ↔ laut · billig ↔ teuer · klein ↔ groß             |
| 🧠 Meinung         | `meinung.js`    | 100  | unterschätzt ↔ überschätzt · langweilig ↔ spannend · ekelhaft ↔ lecker |
| 🎭 Kultur          | `kultur.js`     | 70   | Kinderfilm ↔ Erwachsenenfilm · Eintagsfliege ↔ Legende · Mainstream ↔ Nische |
| 🤪 Schräg          | `schraeg.js`    | 80   | schlechter Superheld ↔ guter Superheld · Hund ↔ Katze · Montag ↔ Freitag |
| 🔥 Ab 18           | `adult.js`      | 50   | harmloses Date ↔ peinliches Date · nüchtern ↔ betrunken (Standard aus)   |

**Format** (Zeilen mit `|`):

```
links | rechts | Stufe
kalt | heiß | 1
unterschätzt | überschätzt | 2
```

**Schreibregeln:**
- Echte **Gegensätze** auf **einer** Dimension (nicht *Hund ↔ Fisch*, außer in „Schräg“, wo genau das der Witz ist)
- Kurz: beide Enden zusammen max. 40 Zeichen, damit es auf dem Handy passt
- Mischung aus **messbar** (kalt ↔ heiß) und **Geschmackssache** (unterschätzt ↔ überschätzt) – die zweiten sorgen
  für die lustigen Diskussionen
- Test: keine doppelten Paare (auch nicht umgedreht), keine leeren Enden

---

## 4. Varianten & Einstellungen

| Option              | Werte                                         | Standard   |
| ------------------- | --------------------------------------------- | ---------- |
| Spielweise          | Ein Gerät / Mit Handys                        | Mit Handys |
| Modus               | 2 Teams / Kooperativ                          | 2 Teams    |
| Ziel                | 10 / 15 Punkte                                | 10         |
| Zielbreite          | normal / schmal (Profis) / breit (Kinder)      | normal     |
| Links/Rechts-Tipp   | an / aus                                      | an         |
| Aufholregel         | an / aus                                      | an         |
| Kategorien          | Mehrfachauswahl                               | alle außer Ab 18 |
| Zeit für das Team   | aus / 60 / 90 / 120 s                         | aus        |
| ✍️ Eigene Skala      | Hinweisgeber/in darf selbst ein Paar eintippen | aus        |
| 🍻 Trinkregeln       | 0 Punkte → Team trinkt 1, 4 Punkte → 2 verteilen | aus      |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 📡 Wellenlänge · Team 🔵 ist dran · Hinweis von Anna      🔵 6  :  4 🟠   │
├──────────────────────────────────────────────────────────────────────────┤
│                         „ K A F F E E “                                  │
│                    .─────────────────────.                               │
│                .─'   ░░░░░░░ verdeckt ░░░ '─.                            │
│             .─'               ╱               '─.                        │
│            /                 ╱  ← Zeiger          \                      │
│           ●─────────────────●──────────────────────●                     │
│         KALT                                     HEISS                   │
│                                                                          │
│   🟠 tippt: ◀ links (2)   rechts ▶ (1)                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Aufdecken:** Die Abdeckung klappt wie ein Fächer auf, Ziel mit 2/3/4 erscheint, Zeiger blinkt, Punkte fliegen
  zum Team. Bei einer 4: Konfetti (`shared/fx.js`).

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 📡 Du gibst den Hinweis  │  │ 📡 „Kaffee“              │  │ 📡 Team 🔵 rät           │
│   kalt ↔ heiß            │  │   kalt ↔ heiß            │  │   kalt ↔ heiß            │
│      .───────.           │  │      .───────.           │  │                         │
│    .' ▒▒█▒▒  '.          │  │    .'   ╱    '.          │  │  Liegt das Ziel …       │
│   ●─────────────●        │  │   ●────●──────●          │  │  [ ◀ links ] [rechts ▶ ] │
│ Sag deinen Hinweis laut! │  │ [ Fertig ✓ ] (1/2)       │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
   Hinweisgeber/in              eigenes Team                    Gegnerteam
```

**Statistik am Ende:** „🎯 Volltreffer-Paar“ (meiste 4er als Hinweisgeber/in), „📻 Gleiche Welle“ (Hinweis mit der
geringsten Abweichung), „🌀 Funkloch“ (größte Abweichung des Abends, mit Skala + Hinweis).

---

## 6. Technische Umsetzung

### Ordner

```
wellenlaenge/                   → https://tbnsuperkid.github.io/wellenlaenge/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/skalen/klassisch.js …      Skalenpaare je Kategorie
  js/scales.js                  einlesen, filtern, ziehen ohne Wiederholung
  js/dial.js                    Halbkreis als SVG: Zeiger, Zielscheibe, Abdeckung, Ziehen per Maus/Finger
  js/engine.js                  Teams, Phasen, Ziel, Zeiger, Wertung, Aufholregel, Spielende, Ansichten
  js/controllers.js             GameRoom.create({ game: 'wellenlaenge', net: 'wellenlaenge-v1-', storage: 'wellenlaenge', engine })
  js/app.js
tests/wellenlaenge.test.js
```

Dazu wie immer: Karte in der Start-`index.html`, Ordner bei `PUBLIC_DIRS` in `server/server.js`, Test in
`package.json`, README-Abschnitt.

### Architektur

- **Laptop = Host + Bühne.** Handys schicken `join`, `team`, `reroll`, `dial` (Winkel), `lock`, `side`, `next`.
- `dial`-Nachrichten kommen sehr oft (Finger zieht) → auf dem Handy auf **10 pro Sekunde drosseln**, der Laptop
  übernimmt immer den letzten Wert.
- **`viewFor(pid)`** schickt den Zielwinkel **nur** an die hinweisgebende Person – Bühne und alle anderen bekommen ihn
  erst in der Phase `reveal`.
- Skala als **SVG** (skaliert sauber auf Fernseher und Handy), Winkel 0–180° als Zahl mit einer Nachkommastelle.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { input: 'phones', mode: 'teams' | 'coop', goal: 10, width: 'normal', sideGuess: true, catchUp: true,
                categories: ['klassisch', …], timer: 0, customScale: false, drinks: false },
    players: [{ id, name, team: 0, connected }],
    teams: [{ name: 'Blau', score: 6, giverIndex: 2 }, { name: 'Orange', score: 4, giverIndex: 0 }],
    active: 0, giver: 'p3',
    scale: { left: 'kalt', right: 'heiß', id: 'klassisch:kalt-heiss' }, rerolled: false,
    target: 132.5,                       // geheim bis reveal
    dial: 90, locks: ['p1'], sideVotes: { p5: 'left', p6: 'right' },
    phase: 'lobby' | 'clue' | 'dial' | 'side' | 'reveal' | 'end',
    used: ['klassisch:kalt-heiss', …], history: [{ scale, clue, target, dial, points, side }]
  }
  ```

### Tests

- Wertung: Abstand zur Mitte → 4/3/2/0, Grenzen genau auf der Streifenkante, Zielbreiten
- Ziel nie so nah am Rand, dass Streifen abgeschnitten werden (Ziel zwischen 17,5° und 162,5°)
- Links/Rechts: richtig/falsch, Zeiger genau auf der Zielmitte (= niemand bekommt den Punkt)
- Aufholregel, Spielende bei 10, beide gleichzeitig über 10, Stechen
- Kooperativ: 7 Skalen, Extra-Skala bei 4, Wertungsstufen
- Inhalt: 400+ Paare, keine Doppelten (auch umgedreht), Längen
- **Gefilterte Ansicht:** Ratende und Bühne kennen `target` vor dem Aufdecken nicht

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                          | Ergebnis              |
| ------ | ------------------------------------------------------------------------------- | --------------------- |
| **1**  | `dial.js` (Halbkreis, Zeiger, Aufdecken-Animation) + 100 Skalen                  | Skala fühlt sich gut an 🎚️ |
| **2**  | Engine + **Ein Gerät**: Teams, Ziel verdecken, Zeiger, Links/Rechts, Wertung, Karte auf der Startseite | Spielbar 📡 |
| **3**  | **Mit Handys**: Ziel aufs Handy, Zeiger live im Team, Abstimmung, Spielleitung, Wiederverbinden | Das volle Erlebnis 📱 |
| **4**  | 400 Skalen, Kooperativ-Modus, Statistik, Eigene Skala, Trinkregeln, Sounds        | Fertig 🎉              |

## 8. Offene Entscheidungen

1. Name: **Wellenlänge** oder etwas anderes?
2. Darf **jede/r im Team** den Zeiger bewegen (Chaos, aber lustig) oder nur eine Person pro Runde?
3. Hinweis immer laut oder (mit Handys) **eintippen** als Standard?
