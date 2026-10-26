# 🔢 Top Ten – Planung

Angelehnt an **Top Ten** (Aurélien Picolet, Cocktail Games, 2020): Jede/r bekommt geheim eine **Zahl von 1 bis 10**.
Dann kommt ein **Thema** –

> *„Wie gut wäre dieses Tier als Haustier? (1 = furchtbar, 10 = perfekt)“*

– und alle nennen etwas, das **zu ihrer Zahl passt**: Wer die 2 hat, sagt *„Ein Stachelschwein“*, wer die 9 hat,
*„Ein Golden Retriever“*. Eine Person, der **Kapitän**, muss die Antworten dann in die **richtige Reihenfolge**
bringen. **Kooperativ:** Alle spielen zusammen.

Ähnlich wie Wellenlänge (Skala), aber alle sind gleichzeitig dran und es geht um die **Reihenfolge**.

> Name: Arbeitstitel **Top Ten**, Ordner `top-ten/` (Alternativen: *Eins bis Zehn*, *Rangliste*).

## Überblick

|                     | 📲 **Ein Gerät** (herumreichen)                   | 📱 **Mit Handys**                                   |
| ------------------- | ------------------------------------------------ | -------------------------------------------------- |
| **Zahl verteilen**   | Gerät herumgeben, jede/r sieht kurz die Zahl       | Zahl auf dem eigenen Handy                          |
| **Antworten**        | laut sagen                                        | laut sagen **oder** tippen (steht dann auf der Bühne) |
| **Sortieren**        | Kapitän sagt die Reihenfolge, Gerät deckt auf      | Kapitän zieht Karten auf seinem Handy in die Reihenfolge |

- **4–9 Personen** (Kapitän + 3–8 mit Zahl), bei 10+ bekommen manche keine Zahl (Zuschauer der Runde)
- **5 Runden**, gemeinsame **Leben** (Einhörner im Original, bei uns ❤️)
- Aufwand gering: **300 Themen** und eine Sortier-Oberfläche

---

## 1. Regeln

### Ablauf einer Runde

1. **Kapitän** wechselt reihum (bekommt keine Zahl).
2. **Zahlen:** Alle anderen bekommen geheim eine Zahl von **1–10, ohne Doppelte**.
3. **Thema:** Der Kapitän zieht ein Thema (darf einmal neu ziehen) und liest es vor. Jedes Thema hat einen
   **Satz** und die **Bedeutung von 1 und 10**.
4. **Antworten:** Reihum (oder in beliebiger Reihenfolge) sagt jede/r eine Antwort. **Verboten:** Zahlen nennen,
   *„ziemlich weit oben“* sagen – nur die Antwort selbst zählt.
5. **Sortieren:** Der Kapitän ruft die Personen **von der kleinsten zur größten** Zahl auf.
   - Jede/r Aufgerufene deckt die Zahl auf.
   - Ist sie **größer** als alle bisher aufgedeckten → ✅ weiter
   - Ist sie **kleiner** als eine schon aufgedeckte → ❌ **1 Leben weg** (für jede falsch eingeordnete Zahl)
6. **Perfekte Runde** (alles richtig) → **+1 Leben** (max. 8).

### Spielende

- Start mit **8 Leben**, **5 Runden**. Am Ende zählen die übrigen Leben:
  *0 „Totalausfall“ · 1–2 „Na ja“ · 3–4 „Ordentlich“ · 5–6 „Stark“ · 7–8 „Top Ten!“*
- Bei 0 Leben ist das Spiel sofort vorbei.

---

## 2. Die Themen 🗂️ (Kernstück)

**Ziel: 300 Themen**, eigene Texte:

| Kategorie          | Datei          | Ziel | Beispiel (1 ↔ 10)                                                          |
| ------------------ | -------------- | ---- | -------------------------------------------------------------------------- |
| 🐾 Bewerten         | `bewerten.js`  | 80   | *Wie gut wäre dieses Tier als Haustier?* (furchtbar ↔ perfekt)              |
| 🦸 Superkräfte      | `kraefte.js`   | 40   | *Eine Superkraft, die …* (nutzlos ↔ unschlagbar)                            |
| 😱 Wie schlimm      | `schlimm.js`   | 60   | *Wie schlimm wäre es, wenn das im Flugzeug passiert?* (egal ↔ Katastrophe)   |
| 🍽️ Essen            | `essen.js`     | 40   | *Ein Essen beim ersten Date* (peinlich ↔ romantisch)                       |
| 🎬 Kultur           | `kultur.js`    | 40   | *Ein Film, den man mit der Oma schauen kann* (auf keinen Fall ↔ unbedingt)  |
| 🎭 Rollenspiel      | `rolle.js`     | 40   | *Du bist ein Hund. Was sagst du, wenn Herrchen nach Hause kommt?* (gelangweilt ↔ ausgerastet) |

**Format:** `Thema | 1 bedeutet | 10 bedeutet`

```
Wie gut wäre dieses Tier als Haustier? | furchtbar | perfekt
```

**Schreibregeln:** Das Thema muss **viele** Antworten erlauben, die man **graduell** abstufen kann. Nichts, was nur
Wissen abfragt (*„Wie alt ist dieser Promi“* → langweilig).

---

## 3. Einstellungen & Varianten

| Option              | Werte                                       | Standard   |
| ------------------- | ------------------------------------------- | ---------- |
| Spielweise          | Mit Handys / Ein Gerät                      | Mit Handys |
| Runden              | 5 / 8 / bis 0 Leben                         | 5          |
| Leben               | 6 / 8 / 10                                  | 8          |
| Antworten tippen    | an / aus                                    | aus        |
| Sortieren           | Original (nacheinander aufrufen) / **Alles auf einmal** (Kapitän legt alle Karten, dann Aufdecken) | Original |
| Zahlen              | 1–10 / 1–100 (schwerer, Variante für Profis) | 1–10     |
| 🏁 Wettkampf         | 2 Teams, jedes Team hat eigene Leben         | aus        |
| 🍻 Trinkregeln       | pro falscher Zahl trinkt die Person mit der Zahl 1 Schluck | aus |

---

## 4. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🔢 Top Ten · Runde 2/5 · Kapitän: Cem                  ❤️❤️❤️❤️❤️❤️❤️ (7)   │
├──────────────────────────────────────────────────────────────────────────┤
│        Wie gut wäre dieses Tier als Haustier?                            │
│        1 = furchtbar                              10 = perfekt            │
│                                                                          │
│   Anna: „Stachelschwein“   Ben: „Golden Retriever“   Dora: „Goldfisch“    │
│   Eli: „Krokodil“          Finn: „Katze“                                  │
│                                                                          │
│   Aufgedeckt:   Eli 1 ✅ → Anna 2 ✅ → Dora 5 ✅ → Finn ?                  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ 🔢 Deine Zahl             │  │ 🔢 Du bist Kapitän        │
│  (gedrückt halten)       │  │ Ruf als Nächstes auf:   │
│                         │  │ [ Anna  „Stachelschw.“ ] │
│          7              │  │ [ Ben   „Golden Retr.“ ] │
│                         │  │ [ Dora  „Goldfisch“    ] │
│ Thema: Haustier         │  │ [ Finn  „Katze“        ] │
│ 1 = furchtbar           │  │                         │
│ 10 = perfekt            │  │                         │
└─────────────────────────┘  └─────────────────────────┘
```

---

## 5. Technische Umsetzung

### Ordner

```
top-ten/                        → https://tbnsuperkid.github.io/top-ten/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/themen/bewerten.js …
  js/topics.js                  einlesen, ziehen ohne Wiederholung
  js/engine.js                  Kapitän reihum, Zahlen verteilen, Antworten, Aufrufen, Leben, Ansichten
  js/controllers.js             GameRoom.create({ game: 'top-ten', net: 'topten-v1-', storage: 'topten', engine })
  js/app.js
tests/top-ten.test.js
```

### Architektur

- Handys schicken `join`, `reroll`, `answer` (optional), `call` (Kapitän ruft auf), `order` (Alles-auf-einmal), `next`.
- **`viewFor(pid)`**: jede/r sieht nur die **eigene** Zahl; aufgedeckte Zahlen sehen alle.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { input: 'phones', rounds: 5, lives: 8, typed: false, sort: 'call', range: 10, versus: false, drinks: false },
    players: [{ id, name, connected }],
    round: 2, captain: 'p3', lives: 7,
    topic: { text: '…', low: 'furchtbar', high: 'perfekt' }, rerolled: false,
    numbers: { p1: 2, p2: 9, p4: 5, … },     // geheim
    answers: { p1: 'Stachelschwein', … },
    revealed: [{ pid: 'p5', n: 1, ok: true }, …],
    phase: 'lobby' | 'topic' | 'answer' | 'sort' | 'result' | 'end'
  }
  ```

### Tests

- Zahlen ohne Doppelte, Kapitän bekommt keine, 10+ Personen
- Wertung: falsche Einordnung kostet je 1 Leben, perfekte Runde +1 (max.), 0 Leben → Ende
- Alles-auf-einmal: Anzahl Fehler = Zahlen, die kleiner sind als eine vorher gelegte
- **Gefilterte Ansicht:** fremde Zahlen erst nach dem Aufdecken

---

## 6. Umsetzung in Etappen

| Etappe | Inhalt                                                                    | Ergebnis     |
| ------ | ------------------------------------------------------------------------- | ------------ |
| **1**  | 100 Themen, Engine, **Ein Gerät** (herumreichen, Aufdecken), Karte auf der Startseite | Spielbar 🔢 |
| **2**  | Mit Handys: Zahl aufs Handy, Kapitän ruft per Handy auf, Antworten tippen   | Das volle Erlebnis 📱 |
| **3**  | 300 Themen, Alles-auf-einmal, 1–100, Wettkampf, Sounds                    | Fertig 🎉     |

## 7. Offene Entscheidungen

1. Name: **Top Ten** (ist auch die Marke) – lieber eigener Name wie *Eins bis Zehn*?
2. Antworten standardmäßig laut oder getippt?
