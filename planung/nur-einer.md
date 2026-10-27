# ☝️ Nur einer – Planung

Unsere Version von **Just One** (Ludovic Roudy, Bruno Sautter, Repos Production, Spiel des Jahres 2019):
Eine Person muss ein **geheimes Wort** erraten. Alle anderen schreiben **einen Hinweis** – aber **doppelte Hinweise
fliegen raus**. Wer *„Strand“* für *Sonne* schreibt, hofft, dass niemand sonst dieselbe Idee hatte.
**Kooperativ:** Alle spielen zusammen gegen das Kartendeck.

Wie bei 2 Dumme ist der **Laptop** die **Bühne**, die **Handys** sind die Hinweis-Tafeln. Das Aussortieren der
Doppelten übernimmt **`shared/match.js`** – genau dafür ist es gebaut.

> Name: **Nur einer**, Ordner `nur-einer/`. ✅ Umgesetzt – siehe Abschnitt 7 und 8.

## Überblick

|                       | 🖥️ **Ein Gerät** (Notfall)                         | 📱 **Mit Handys** (Standard)                          |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| **Geheimes Wort**      | ratende Person schaut weg, Laptop zeigt das Wort   | steht auf allen Handys außer dem der ratenden Person |
| **Hinweise schreiben** | auf Zettel                                        | auf dem Handy                                        |
| **Doppelte streichen** | von Hand                                          | **automatisch** + Kontrolle durch die Runde           |
| **Raten**              | laut                                              | laut (Spielleitung klickt richtig/falsch) oder getippt |

- **3–12 Personen** (Original 3–7; ab 8 werden doppelte Hinweise so häufig, dass es eine Variante braucht)
- **13 Karten** pro Spiel, Ergebnis am Ende = Anzahl richtig geratener Wörter
- Aufwand gering: Begriffe gibt es schon (Guess the word!, 2 Dumme, Imposter), Prüfung gibt es schon (`match.js`)

---

## 1. Regeln (wie das Original)

### Ablauf einer Runde

1. **Ratende Person** wechselt reihum. Sie wählt eine Zahl **1–5** (= welches der 5 Wörter auf ihrer Karte) –
   bei uns zieht die App direkt ein Wort, die Zahl entfällt.
2. **Wort sehen:** Alle anderen sehen das Wort. Wer es nicht kennt, drückt *„Kenn ich nicht“* → neues Wort.
3. **Hinweis schreiben:** Jede/r schreibt geheim **genau ein Wort**. Ungültig sind:
   - das **Wort selbst** oder Teile davon, **Wortfamilie** (*Sonne* → *sonnig*), Übersetzungen (*Sun*)
   - **ausgedachte Wörter**, Zahlen als Ziffern sind ok (*„7“*), Abkürzungen nur wenn gängig
   - Wörter, die gleich **klingen** (*Mehr* für *Meer*)
4. **Vergleichen:** Die Hinweise werden aufgedeckt (die ratende Person schaut weg). **Identische** und **ungültige**
   Hinweise werden **gestrichen**. Identisch heißt auch: Plural, gleiche Wortfamilie, Tippfehler.
5. **Raten:** Die ratende Person sieht die übrig gebliebenen Hinweise und hat **einen** Versuch.
   - **Richtig** → Karte gewonnen ✅
   - **Falsch** → diese Karte **und die nächste** sind verloren ❌❌
   - **Passen** → nur diese Karte ist verloren ❌

### Spielende & Wertung

Nach 13 Karten (bzw. wenn der Stapel leer ist) zählen die gewonnenen Karten:

| Karten | Wertung (frei übersetzt)                   |
| ------ | ------------------------------------------ |
| 13     | 🏆 Perfekt! Schafft ihr das noch mal?        |
| 12     | Unglaublich – ihr seid ein eingespieltes Team |
| 11     | Großartig, die Runde redet noch morgen davon |
| 9–10   | Super, da geht aber noch was               |
| 7–8    | Guter Durchschnitt                         |
| 4–6    | Ganz okay, nächstes Mal besser             |
| 0–3    | Probiert's noch mal 😅                      |

**Bestenliste** pro Gerät (Datum, Personenzahl, Ergebnis), damit man sich über Abende hinweg verbessern kann.

---

## 2. Die Doppel-Prüfung 🔍 (Kernstück)

Hier hilft `shared/match.js` (`normalize`, `same`, `groups`, `assess`):

1. **Normalisieren** (klein, Umlaute, Satzzeichen, Leerzeichen am Rand).
2. **Ungültig gegen das Lösungswort:** gleich, enthält das Lösungswort (ab 4 Buchstaben) oder ist darin enthalten,
   gleicher Wortstamm (einfache Endungs-Regeln: *-e, -en, -er, -n, -s, -ig, -lich, -chen*), mehr als ein Wort.
3. **Doppelte untereinander:** `groups()` bildet Gruppen gleicher Hinweise (Plural, Tippfehler).
   Jede Gruppe mit 2+ Hinweisen wird gestrichen.
4. **Kontrolle durch die Runde:** Die Bühne zeigt die Hinweise nach Gruppen sortiert, **gestrichene rot**. Alle
   Hinweisgebenden sehen das auf dem Handy und können per Antippen **„doch gültig“ / „doch streichen“** vorschlagen,
   die Spielleitung entscheidet. Erst dann sieht die ratende Person etwas.

> Die App irrt sich bei Synonymen (*Auto* / *Wagen* sind **nicht** identisch – richtig so) und bei Wortfamilien,
> die sie nicht erkennt (*fliegen* / *Flug*). Deshalb ist Schritt 4 Pflicht.

Beim **Raten** prüft `same()` die Antwort gegen das Lösungswort (*„die Sonne“* = *Sonne*). Mit getippter Antwort
gilt dieselbe Kontrolle: Spielleitung kann *„zählt doch“* drücken.

---

## 3. Die Wörter

- Grundlage: **Begriffe aus Guess the word!** (`erklaeren.js`) und **Imposter** (`woerter.js`), dazu eine eigene Liste
  `js/woerter.js` mit **Wörtern, die viele Assoziationen haben** (*Sonne, Schule, Weihnachten, Hund*) – sonst sind
  Doppelte zu selten oder zu häufig.
- **Ziel: 800 Wörter** in Stufen 1–3. Stufe 1 = konkrete Dinge (*Pizza*), Stufe 3 = abstrakt (*Eifersucht*).
- Die Datei-Formate sind verschieden → kleiner Adapter `js/words.js`, der alle Quellen einliest und Doppelte entfernt.
- Gespielte Wörter merkt sich das Gerät (wie `deck.js`).

---

## 4. Varianten & Einstellungen

| Option                | Werte                                                       | Standard   |
| --------------------- | ----------------------------------------------------------- | ---------- |
| Spielweise            | Mit Handys / Ein Gerät                                      | Mit Handys |
| Karten                | 13 / 20 / unendlich (bis 3 Fehler)                          | 13         |
| Raten                 | laut / tippen                                               | laut       |
| Schwierigkeit         | leicht / gemischt / schwer                                  | gemischt   |
| Zeit zum Schreiben    | aus / 30 / 60 s                                             | 60 s       |
| **Große Runde (8+)**  | Die Hinweisgebenden werden in **2 Gruppen** geteilt, die sich abwechseln – pro Karte schreiben nur 4–6 Personen | automatisch |
| **3 Personen**        | jede/r schreibt **2 Hinweise** (Original-Regel)               | automatisch |
| 🏁 Wettkampf           | 2 Teams wechseln sich ab, wer mehr Karten holt, gewinnt      | aus        |
| ✍️ Eigenes Wort        | Spielleitung darf ein Wort eintippen                         | aus        |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☝️ Nur einer · Karte 6/13 · Ben rät             ✅ 4   ❌ 1   Stapel: 7    │
├──────────────────────────────────────────────────────────────────────────┤
│   Phase 1:  🙈 Ben, schau weg!          (Wort nur auf den Handys)         │
│                                                                          │
│   Phase 2 (Ben schaut weg):                                              │
│       STRAND   STRAND          Sommer       ~~heiß~~  ~~heiss~~            │
│        ✗ doppelt             ✓          ✗ doppelt                       │
│       Creme ✓        Brille ✓      Solarium ✓                             │
│                                                                          │
│   Phase 3 (Ben darf schauen):   Sommer · Creme · Brille · Solarium       │
│   [ ✅ Richtig ]  [ ❌ Falsch ]  [ ⏭️ Passen ]                                │
└──────────────────────────────────────────────────────────────────────────┘
```

- Bei **Ein Gerät** wird nur Phase 1 (Wort zeigen mit Wegschau-Hinweis) und Phase 3 (Knöpfe) gebraucht.
- Gestrichene Hinweise werden nach dem Raten wieder gezeigt – das Lachen über *„Strand, Strand“* gehört dazu.

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ ☝️ Ben rät               │  │ ☝️ Kontrolle             │  │ ☝️ Du rätst!             │
│                         │  │                         │  │                         │
│   Das Wort:  SONNE       │  │ STRAND  ✗ (du + Cem)    │  │  🙈 Augen zu, bis        │
│                         │  │ Sommer  ✓               │  │   alle fertig sind …     │
│  Dein Hinweis:          │  │ heiß    ✗               │  │                         │
│  [ Strand          ]    │  │ [ Passt so ✓ ]           │  │  → dann auf den Laptop   │
│  [ Senden ✓ ] 42 s       │  │ [ Einspruch ✋ ]          │  │    schauen               │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „🦄 Einzigartig“ (nie doppelt), „👯 Seelenverwandte“ (die zwei, die am häufigsten denselben
Hinweis hatten), „🎯 Bester Hinweis“ (einziger übrig gebliebener Hinweis, der trotzdem gereicht hat).

---

## 6. Technische Umsetzung

### Ordner

```
nur-einer/                      → https://tbnsuperkid.github.io/nur-einer/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/woerter.js                 eigene Wortliste
  js/words.js                   Adapter: eigene + Guess-the-word- + Imposter-Wörter, Stufen, ohne Doppelte
  js/clues.js                   Hinweise prüfen: ungültig gegen Lösung, Gruppen bilden (auf shared/match.js)
  js/engine.js                  Reihum raten, Phasen, Kartenstapel, Wertung, Ansichten
  js/controllers.js             GameRoom.create({ game: 'nur-einer', net: 'nureiner-v1-', storage: 'nureiner', engine })
  js/app.js
tests/nur-einer.test.js
```

### Architektur

- Handys schicken `join`, `skip` (Kenn ich nicht), `clue`, `objection` (Einspruch), `guess` / `pass`, `judge`
  (Spielleitung: richtig/falsch/zählt doch), `next`.
- **`viewFor(pid)`**: Die ratende Person bekommt **nie** das Wort, und die Hinweise erst nach der Kontrolle (und nur
  die gültigen). Die Bühne zeigt die Hinweise in der Kontrolle – deshalb ruft die Bühne laut *„Ben, schau weg!“*
  und hat einen großen **„🙈 Ben schaut weg“**-Bestätigungsknopf auf Bens Handy.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { input: 'phones', cards: 13, guess: 'voice', level: [1, 2], timer: 60, bigGroup: 'auto', versus: false },
    players: [{ id, name, connected, stats: { unique: 9, dupes: 2 } }],
    guesser: 'p2', order: ['p1', 'p2', 'p3', …],
    deck: 7, won: 4, lost: 1,
    word: 'Sonne',                                   // nicht für guesser
    clues: { p1: 'Strand', p3: 'Strand', p4: 'Sommer', … },
    verdict: { p1: 'dupe', p3: 'dupe', p4: 'ok', p5: 'invalid' },
    objections: ['p5'],
    phase: 'lobby' | 'word' | 'write' | 'check' | 'guess' | 'reveal' | 'end',
    used: ['sonne', …], history: [{ word, guesser, clues, verdict, result: 'won' | 'lost' | 'pass' }]
  }
  ```

### Tests

- Prüfung: gleiches Wort, Plural, Tippfehler → doppelt; *Sonne* / *sonnig* / *Sonnenbrille* / *Sun* → ungültig gegen
  Lösung (*Sun* nur, wenn in einer kleinen Übersetzungs-Liste, sonst Einspruch); zwei Wörter → ungültig
- Wertung: richtig +1, falsch kostet 2 Karten (auch wenn nur noch 1 übrig ist), passen kostet 1
- 3 Personen: 2 Hinweise pro Person, doppelte auch innerhalb einer Person
- Reihum: ratende Person schreibt nie, Abgemeldete werden übersprungen
- **Gefilterte Ansicht:** ratende Person kennt `word` und `clues` nicht vor `guess`
- Inhalt: 800 Wörter, keine Doppelten über alle Quellen

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                     | Ergebnis            |
| ------ | -------------------------------------------------------------------------- | ------------------- |
| **1** ✅ | `clues.js` + Tests, Wortliste/Adapter                                       | Prüfung sitzt 🔍     |
| **2** ✅ | Engine + **Mit Handys**: Wort verteilen, Hinweise, Kontrolle, Raten, 13 Karten, Wertung, Karte auf der Startseite | Spielbar ☝️ |
| **3** ✅ | Ein Gerät, große Runde / 3 Personen, Wettkampf, Bestenliste, Statistik, Sounds | Fertig 🎉            |

Hier zuerst mit Handys, weil das Spiel ohne Handys kaum Vorteile gegenüber Zetteln hat.

## 8. Entscheidungen

**Entschieden:** Name **Nur einer** · Raten standardmäßig **laut** (Tippen als Einstellung, mit „zählt doch“) ·
Wortfamilie eher **streng** erkennen (Wortstamm mit einfachen Endungs-Regeln, Tippfehler schon ab 5 Buchstaben) –
die Runde korrigiert per Einspruch · Bestenliste nur für fertig gespielte Partien.

**Umsetzung im Detail:**
- **Wettkampf:** Jedes Team hat einen eigenen Stapel mit der halben Kartenzahl (13 → je 7, 20 → je 10), es schreibt nur
  das eigene Team. Endlos gibt es im Wettkampf nicht.
- **Endlos:** Nur *falsch* zählt als Fehler (3 Fehler = Ende), *passen* kostet nur die Karte.
- **Falsch bei der letzten Karte:** Wie im Original geht dafür eine schon gewonnene Karte verloren.
- **Große Runde:** ab 7 Hinweisgebenden (= 8 Personen) schreibt pro Karte abwechselnd die Hälfte; wer pausiert, sieht das
  Wort trotzdem und darf Einspruch einlegen.
- **Kontrolle:** Die Bühne zeigt die Hinweise erst, wenn die ratende Person am Handy „🙈 Ich schaue weg“ drückt (oder am Laptop
  bestätigt wird). Das Wort selbst steht mit Handys bis zur Auflösung nie auf dem Laptop.
- **Spielleitung am Handy:** das erste verbundene Handy, das nicht gerade rät (für den Fernseher als Bühne).
- **Wörter:** 996 (eigene Liste + Guess the word! + Imposter ohne 18+, Berufe ohne „:in“), Stufe 1 / 2 / 3 = 370 / 434 / 192.

**Stand:** Alle Tests grün (`tests/nur-einer.test.js`). Im Browser durchgespielt: mit 4 Handys (Kontrolle mit Einspruch,
Raten, Auflösung, Spielende), zu dritt mit Tippen und eigenem Wort, Wettkampf (Lobby und erste Karte; ganzer Ablauf im Test), ein Gerät bis zum Ende mit Bestenliste.
