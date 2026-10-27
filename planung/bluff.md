# 🤥 Echt jetzt? (Arbeitstitel Bluff) – Planung

Unsere Version von **Fibbage** (Jackbox Games) und **Nobody is perfect** (Ravensburger): Am Laptop erscheint eine
Frage mit einer **kuriosen, echten Antwort** –

> *„Die Kettensäge wurde ursprünglich für ___ erfunden.“* → **Geburtshilfe**

Alle erfinden auf dem Handy eine **falsche Antwort**, die glaubwürdig klingt. Dann stehen alle Antworten plus die
echte auf der Bühne, und jede/r tippt, welche die **Wahrheit** ist. Punkte gibt es fürs **richtige Tippen** und
dafür, **andere hereinzulegen**.

Das Spiel braucht **Handys** (geheime Antworten schreiben) – ein Gerät reicht nicht. Der Laptop ist die Bühne.

> Name: **Echt jetzt?**, Ordner `echt-jetzt/` (Arbeitstitel *Bluff*). ✅ Umgesetzt – siehe Abschnitt 8 und 9.

## Überblick

- **3–10 Personen** einzeln (ab 8 wird die Auswahl lang, dann Variante „nur 6 Lügen zeigen“)
- **2 Runden à 3–4 Fragen + Finale** (Punkte im Finale doppelt), dazu ein **Wörterbuch-Modus**
- Gerät: **Laptop + Handys**
- Aufwand: **400 Fragen mit geprüfter Wahrheit** – das ist die Hauptarbeit (wie bei Pi mal Daumen)

---

## 1. Ablauf einer Frage

| Phase           | Was passiert                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------- |
| **1. Frage**     | Bühne liest/zeigt die Frage mit Lücke. Optional wählt eine Person aus **3 Kategorien** (*Tiere, Gesetze, Erfindungen*). |
| **2. Lügen**     | Alle tippen eine falsche Antwort (Standard 60 s). Kommt die Antwort **der Wahrheit zu nah** → *„🤫 Das ist (fast) die Wahrheit! Denk dir was anderes aus.“* |
| **3. Tippen**    | Bühne zeigt alle Antworten gemischt + die Wahrheit. Jede/r tippt auf dem Handy eine an – die **eigene ist gesperrt**. |
| **4. Auflösung** | Antworten werden einzeln aufgedeckt: *„STEUERBERATER – geschrieben von Cem, reingefallen: Anna, Dora“*. Zum Schluss die Wahrheit. |
| **5. Likes**     | Optional: 👍 für die lustigste Lüge (kleiner Bonus, zählt für die Auszeichnung am Ende). |

### Punkte

| Wofür                                        | Runde 1 | Runde 2 | Finale |
| -------------------------------------------- | ------- | ------- | ------ |
| Wahrheit getippt                             | 1000    | 1500    | 2000   |
| Pro Person, die auf **meine Lüge** reinfällt | 500     | 750     | 1000   |
| Wenn **zwei** dieselbe Lüge schreiben         | geteilt – Antwort steht nur einmal da, Punkte für beide | | |
| 👍 Like                                       | 100     | 100     | 100    |

**Finale:** Eine letzte Frage für alle, im Finale tippt man **zwei** Antworten (Wahrheit = erste Wahl,
zweite Wahl gibt halbe Punkte) – frei anpassbar.

---

## 2. Die Prüfung „zu nah an der Wahrheit“

- `shared/match.js` (`same`, Tippfehler-Toleranz) vergleicht die Lüge mit der **Wahrheit** und den
  **weiteren erlaubten Formen** aus der Datenbank (*„Fische“*, *„einen Fisch“*).
- Ebenso: **Lügen untereinander** – gleiche Lügen werden zusammengelegt (stehen einmal da, beide bekommen die Punkte).
- Wer bis zum Ende der Zeit nichts schreibt, bekommt eine **Lüge vom Haus** aus der Datenbank (Feld *Köder*),
  damit die Auswahl voll bleibt – sie gibt keine Punkte.

---

## 3. Die Fragen 📚 (Kernstück)

**Ziel: 400 Fragen**, Kategorien als Dateien:

| Kategorie             | Datei            | Ziel | Beispiel (Lücke → Wahrheit)                                                  |
| --------------------- | ---------------- | ---- | ---------------------------------------------------------------------------- |
| ⚖️ Kuriose Gesetze     | `gesetze.js`     | 60   | *In Singapur ist der Verkauf von ___ verboten.* → **Kaugummi**                |
| 🐾 Tiere               | `tiere.js`       | 70   | *Eine Gruppe Flamingos nennt man auf Englisch ___.* → **flamboyance**          |
| 🔧 Erfindungen         | `erfindungen.js` | 50   | *Die Kettensäge wurde ursprünglich für ___ erfunden.* → **Geburtshilfe**       |
| 🧑 Menschen & Rekorde  | `menschen.js`    | 60   | *Napoleon wurde einmal von ___ angegriffen.* → **Kaninchen**                  |
| 🇩🇪 Deutschland         | `deutschland.js` | 60   | *Das längste deutsche Wort im Duden ist ___.* → (aktuell prüfen!)             |
| 🍕 Essen               | `essen.js`       | 50   | *Ketchup wurde im 19. Jahrhundert als ___ verkauft.* → **Medizin**            |
| 🌍 Orte & Namen        | `orte.js`        | 50   | *In Österreich gibt es einen Ort namens ___.* → (echte Ortsnamen)            |

**Format:**

```
Frage mit ___ | Wahrheit | weitere Formen (;) | Köder 1; Köder 2; Köder 3 | Quelle
In Singapur ist der Verkauf von ___ verboten. | Kaugummi | Kaugummis | Feuerwerk; Comics; Blumenerde | https://…
```

**Regeln:**
- **Jede Frage braucht eine Quelle** (Link im Feld *Quelle*, wird im Spiel nach der Auflösung klein gezeigt).
  Viele „kuriose Fakten“ im Internet sind falsch – lieber 300 sichere als 500 wacklige.
- Wahrheit **kurz** (1–3 Wörter), damit sie zwischen den Lügen nicht auffällt
- Die Wahrheit muss **überraschend** sein – wenn man sie leicht errät, ist die Frage langweilig
- Eigene Formulierungen, nicht aus Fibbage oder Quiz-Seiten abschreiben
- Test: Lücke `___` genau einmal, Wahrheit max. 30 Zeichen, mind. 3 Köder, Quelle vorhanden

### 📖 Wörterbuch-Modus (wie *Nobody is perfect* / *Balderdash*)

- Statt Fakten: **seltene echte Wörter** – *„Was bedeutet Kummerspeck?“* reicht nicht, eher *„Was ist ein
  Hagestolz?“* → **ein älterer Junggeselle**.
- Alle erfinden eine **Erklärung**, sonst gleiche Regeln. Bewertung der Nähe zur Wahrheit ist hier schwer →
  die Spielleitung sieht vor dem Aufdecken die Liste und kann zu nahe Erklärungen **zusammenlegen**.
- **200 Wörter** in `woerterbuch.js`, auch hier mit Quelle (Duden/DWDS).

---

## 4. Einstellungen

| Option              | Werte                                      | Standard |
| ------------------- | ------------------------------------------ | -------- |
| Modus               | Fakten / Wörterbuch / gemischt             | Fakten   |
| Länge               | kurz (2 × 2 + Finale) / normal (2 × 3 + Finale) / lang (2 × 4 + Finale) | normal |
| Zeit zum Lügen      | 45 / 60 / 90 s                             | 60 s     |
| Zeit zum Tippen     | 20 / 30 / 45 s                             | 30 s     |
| Kategorie wählen    | an (reihum 1 von 3) / aus (zufällig)        | an       |
| Likes               | an / aus                                   | an       |
| Max. Antworten auf der Bühne | alle / 6 / 8                       | alle     |
| 🍻 Trinkregeln       | auf Lüge reingefallen → 1 Schluck pro Lüge, Wahrheit getippt → 1 verteilen | aus |

---

## 5. Bildschirme

### Laptop – Tippen

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🤥 Bluff · Runde 1 · Frage 2/3 · ⚖️ Kuriose Gesetze            ⏱ 24 s     │
├──────────────────────────────────────────────────────────────────────────┤
│       In Singapur ist der Verkauf von  _ _ _ _  verboten.                │
│                                                                          │
│     ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐       │
│     │ FEUERWERK  │  │  KAUGUMMI  │  │ GARTENZWERGEN│ │  KETCHUP   │       │
│     └────────────┘  └────────────┘  └────────────┘  └────────────┘       │
│     ┌────────────┐  ┌────────────┐                                      │
│     │ SOCKEN     │  │ LUFTBALLONS│        getippt: 4/6                   │
│     └────────────┘  └────────────┘                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Laptop – Auflösung

- Eine Karte nach der anderen: wer darauf reingefallen ist (Avatare fliegen auf die Karte), dann **wer sie geschrieben
  hat** und *„+1000“*. Lügen, auf die niemand reingefallen ist, gehen schnell. **Die Wahrheit zuletzt** mit Trommelwirbel.
- Darunter klein: *„Quelle: …“*.

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 🤥 Deine Lüge  ⏱ 41 s    │  │ 🤥 Was ist wahr?         │  │ 🤥 Auflösung             │
│                         │  │                         │  │                         │
│ In Singapur ist der     │  │ [ FEUERWERK         ]   │  │ 2 sind auf deine Lüge   │
│ Verkauf von ___         │  │ [ KAUGUMMI          ]   │  │ „Gartenzwerge“ rein!    │
│ verboten.               │  │ [ GARTENZWERGE  (du)]🔒 │  │      +1000               │
│                         │  │ [ KETCHUP           ]   │  │ Wahrheit: KAUGUMMI ✓     │
│ [ Gartenzwerge     ]    │  │ [ SOCKEN            ]   │  │      +1000               │
│ [ Senden ✓ ]             │  │ [ LUFTBALLONS       ]   │  │ 👍 Like vergeben          │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „🎭 Meisterlügner/in“ (meiste Reingefallene), „🧐 Lügendetektor“ (meiste Wahrheiten),
„🐟 Leichtgläubig“ (meistens reingefallen), „😂 Beste Lüge“ (meiste Likes, mit Text).

---

## 6. Technische Umsetzung

### Ordner

```
echt-jetzt/                     → https://tbnsuperkid.github.io/echt-jetzt/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/fragen/gesetze.js …        Fragen je Kategorie, woerterbuch.js
  js/questions.js               einlesen, prüfen, Kategorien anbieten, ziehen ohne Wiederholung
  js/engine.js                  Runden, Phasen, Lügen sammeln/zusammenlegen, Tippen, Punkte, Likes, Ansichten
  js/controllers.js             GameRoom.create({ game: 'echt-jetzt', net: 'echtjetzt-v1-', storage: 'echtjetzt', engine })
  js/app.js
tests/echt-jetzt.test.js
```

### Architektur

- Handys schicken `join`, `category`, `lie`, `pick`, `like`, `merge` (Spielleitung, Wörterbuch), `next`.
- **`viewFor(pid)`**: Die Wahrheit kennt **nur der Laptop**. In der Phase `pick` bekommen Handys die gemischte
  Liste als **Texte ohne Herkunft** (keine Kennzeichnung, welche Karte die Wahrheit ist oder von wem sie stammt –
  auch nicht in IDs). Die eigene Lüge ist markiert, damit man sie nicht antippen kann.
- Die Reihenfolge der Antworten wird **einmal** auf dem Laptop gemischt und für Bühne und Handys gleich verwendet.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { mode: 'facts' | 'dict' | 'mixed', length: 'normal', lieTime: 60, pickTime: 30, chooseCategory: true,
                likes: true, maxShown: 0, drinks: false },
    players: [{ id, name, score, stats: { fooled: 4, truths: 3, fell: 2, likes: 5 }, connected }],
    round: 1, index: 2, chooser: 'p3',
    question: { id: 'gesetze:singapur', text: '…', truth: 'Kaugummi', forms: ['Kaugummis'], decoys: […], source: '…' },
    lies: { p1: 'Feuerwerk', p2: 'Gartenzwerge', … },
    options: [{ key: 'a', text: 'FEUERWERK', authors: ['p1'] }, { key: 'b', text: 'KAUGUMMI', truth: true }, …],
    picks: { p1: 'b', p2: 'a', … }, likes: { p4: 'a' },
    phase: 'lobby' | 'category' | 'lie' | 'pick' | 'reveal' | 'scores' | 'final' | 'end',
    used: ['gesetze:singapur', …]
  }
  ```

### Tests

- Lüge = Wahrheit (auch Plural, Tippfehler, *„ein Kaugummi“*) → abgelehnt; zwei gleiche Lügen → eine Karte, beide punkten
- Eigene Lüge nicht wählbar, Köder füllen bei fehlender Lüge auf, Köder geben keine Punkte
- Punkte je Runde, Finale doppelt, Likes
- **Gefilterte Ansicht**: `truth`, `authors` und `truth: true` sind vor `reveal` auf keinem Handy und nicht auf der Bühne
- Inhalt: 400 Fragen, Lücke genau einmal, Quelle vorhanden, keine doppelten Fragen

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                   | Ergebnis           |
| ------ | ------------------------------------------------------------------------ | ------------------ |
| **1** ✅ | **100 Fragen mit Quellen** + `questions.js` + Inhalts-Tests                | Erste Fragen ✅     |
| **2** ✅ | Engine + Handys: Lügen, Nähe-Prüfung, Tippen, Auflösung, Punkte, Karte auf der Startseite | Spielbar 🤥 |
| **3** ✅ | Finale, Likes, Kategorie wählen, Statistik, Sounds, Wörterbuch-Modus      | Das volle Erlebnis  |
| **4** ✅ | auf 400 Fragen + 200 Wörter auffüllen, Trinkregeln, 👎 Melden wie bei Schlecht erklärt | Fertig 🎉 |

## 8. Entscheidungen (geklärt)

1. Name: **Echt jetzt?** (Ordner `echt-jetzt/`)
2. Wörterbuch-Modus: **von Anfang an** (Fakten / Wörterbuch / gemischt)
3. Vorlesen: **ja, Standard an** (`shared/speech.js` – Frage, alle Karten, Auflösung; Tipp-Zeit läuft erst danach)
4. Wörterbuch-Prüfung ohne Spoiler: Die Spielleitung (Laptop oder erstes Handy) sieht nur die gemischten Karten **ohne**
   Kennzeichnung der Wahrheit und legt zusammen, was dasselbe meint. Landet eine Lüge auf der Wahrheit, hat ihre Autorin /
   ihr Autor die Wahrheit **getroffen** (Wahrheits-Punkte, tippt nicht mit). So kann die Spielleitung selbst mitspielen.
5. Umfang: **400+ Fragen und 200+ Wörter** gleich zu Beginn

## 9. Stand der Umsetzung

- **434 Fragen:** Gesetze 63, Tiere 74, Erfindungen 58, Menschen & Rekorde 62, Deutschland 66, Essen 54, Orte & Namen 57 –
  und **238 Wörter** im Wörterbuch. Jede Zeile mit Quelle (Wikipedia, Wiktionary, DWDS, dejure.org).
  ⚠️ Die Quellen sind nach bestem Wissen gesetzt, aber nicht jede einzeln im Browser geöffnet – **👎 Melden** sammelt Fehler.
- Kleine Ergänzungen zum Plan: Kategorie-Auswahl (welche Fakten-Kategorien in den Topf kommen); im Wörterbuch 15 s mehr
  zum Lügen und Tippen, im Finale 10 s mehr zum Tippen; mindestens drei Lügen neben der Wahrheit (sonst füllt das Haus auf);
  „zu nah“ prüft Zahlen exakt (12 cm ≠ 14 cm) und erkennt die Wahrheit als ganzes Wort in der Lüge (*Kaugummi mit Minze*,
  aber nicht *Augenlider* bei *Augen*); Auszeichnung zusätzlich 🪤 *Die Falle des Abends*; Leertaste / → schaltet weiter.
- **Tests:** `tests/echt-jetzt.test.js` (32 Tests). Im Browser durchgespielt (stumm, Laptop + 4 Handys über den Node-Server):
  je eine Partie *gemischt* (mit Wörterbuch-Prüfung) und *Fakten* bis zur Siegerehrung, ohne Fehler in der Konsole.
