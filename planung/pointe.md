# 😂 Pointe! – Planung

Unsere Version von **Quiplash** (Jackbox Games): Auf dem Handy bekommt man **lustige Satzanfänge** –

> *„Der schlechteste Name für ein Kreuzfahrtschiff: ___“*

– und tippt die witzigste Antwort, die einem einfällt. Jeder Satzanfang geht an **genau zwei Personen**. Auf der
Bühne treten dann die zwei Antworten **im Duell** gegeneinander an, alle anderen stimmen ab. Wer mehr Stimmen holt,
bekommt mehr Punkte – wer **alle** Stimmen holt, landet eine **„Pointe!“** mit Bonus.

Das Spiel braucht **Handys**. Der Laptop ist die Bühne (Duelle, Abstimmung, Punkte).

> Name: **Pointe!**, Ordner `pointe/`. ✅ Umgesetzt – siehe Abschnitt 6 bis 8.

## Überblick

- **3–10 Personen** (bei 3 stimmt pro Duell nur eine Person ab – geht, ist aber knapp; ideal 5–8)
- **Publikum:** ab Person 11 oder freiwillig – stimmt nur ab, schreibt nicht
- **3 Runden**: 2 × Duelle, 1 × „Letzte Pointe“ (alle gegen alle)
- Gerät: **Laptop + Handys**
- Aufwand: **600 Satzanfänge** – eigene Texte, mit Altersfilter

---

## 1. Ablauf

### Runde 1 & 2 – Duelle

1. **Verteilen:** Jede Person bekommt **2 Satzanfänge**, jeder Satzanfang geht an **2 Personen**. Bei *n* Personen
   gibt es also *n* Duelle pro Runde (jede Person ist in genau zwei Duellen, gegen zwei verschiedene Gegner).
2. **Schreiben:** 90 s für beide Antworten. Leer = *„(keine Antwort)“* – die verliert automatisch.
   Kein Einfall? Knopf **„🎲 Rettung“** setzt eine vorgefertigte Antwort aus der Datenbank ein (gibt halbe Punkte).
3. **Duelle:** Die Bühne zeigt den Satzanfang und beide Antworten **ohne Namen**. Alle, die nicht im Duell stehen,
   stimmen ab (15 s).
4. **Auflösung:** Namen erscheinen, Prozentbalken wächst.

### Punkte

| Wofür                              | Runde 1 | Runde 2 | Runde 3 |
| ---------------------------------- | ------- | ------- | ------- |
| Pro Prozent der Stimmen            | 10      | 20      | (s. u.) |
| **Pointe!** (alle Stimmen)          | +250    | +500    | –       |
| Gewinner des Duells                | +100    | +200    | –       |
| „🎲 Rettung“ benutzt                | Punkte halbiert |   |         |

Publikumsstimmen zählen als **ein gemeinsamer Anteil** (z. B. 20 % der Gesamtstimmen), damit eine große Zuschauer-Gruppe
nicht alles entscheidet.

### Runde 3 – Letzte Pointe

- **Alle** bekommen **denselben** Satzanfang, alle Antworten stehen gleichzeitig auf der Bühne.
- Jede/r vergibt **3 Stimmen** (auch mehrere auf dieselbe Antwort, nicht auf die eigene).
- Punkte: **300 pro Stimme**. Spezialformate für Abwechslung:
  - *„Drei Dinge, die man nicht im Bewerbungsgespräch sagt: ___, ___, ___“* (drei Felder)
  - *„Erfinde ein Wort für ___“*

---

## 2. Die Satzanfänge ✍️ (Kernstück)

**Ziel: 600 Satzanfänge**, eigene Texte (keine aus Quiplash übernehmen):

| Kategorie         | Datei          | Ziel | Beispiele                                                           |
| ----------------- | -------------- | ---- | ------------------------------------------------------------------- |
| 🏠 Alltag          | `alltag.js`    | 150  | *Was die Waschmaschine heimlich über dich denkt* · *Die schlechteste Ausrede fürs Zuspätkommen* |
| 🎬 Popkultur       | `popkultur.js` | 100  | *Ein Film, der garantiert floppen würde: ___* · *Der neue Song von Helene Fischer heißt: ___* |
| 🤔 Was wäre wenn   | `waswaere.js`  | 100  | *Wenn Katzen sprechen könnten, wäre ihr erster Satz: ___*           |
| 📛 Namen erfinden  | `namen.js`     | 80   | *Der schlechteste Name für ein Kreuzfahrtschiff* · *Ein Parfüm, das niemand kaufen würde* |
| 🎓 Arbeit & Schule | `arbeit.js`    | 70   | *Was man am ersten Arbeitstag lieber nicht sagt*                    |
| 🔥 Ab 18           | `adult.js`     | 100  | *Der peinlichste Satz beim ersten Date* (Standard aus)              |
| 🏁 Letzte Pointe   | `finale.js`    | 60   | Mehrfeld-Formate (s. o.)                                             |

**Format:** `Text mit ___ | Rettung 1; Rettung 2; Rettung 3` – die *Rettungen* sind mittelmäßige, aber passende Antworten.

**Schreibregeln:**
- **Offen** – es darf nicht *die eine* lustige Antwort geben, sonst schreiben beide dasselbe
- **Konkret** – *„Etwas Lustiges“* ist zu breit, *„Was der Hund denkt, wenn du ‚Gassi‘ sagst und dann doch nicht gehst“* ist gut
- Keine echten Privatpersonen; **Promis** nur harmlos (Kategorie Popkultur)
- **Platzhalter für Mitspielende:** *„Was {Spieler} heimlich sammelt“* – die App setzt einen echten Namen aus der Runde
  ein (abschaltbar, Standard **aus** – kann gemein werden)

### Familie / Ab 18

- Standard: alles außer *Ab 18*. Einstellung **„Familienrunde“** blendet auch zweideutige Einträge aus (Markierung `{fam:0}`).
- Freie Texte der Spielenden kann die App nicht filtern – Hinweis in der Lobby. Die Spielleitung kann eine Antwort
  **nachträglich ausblenden** (🙈), das Duell zählt dann für den Gegner. (Vorab prüfen wäre zu langsam.)

---

## 3. Einstellungen

| Option              | Werte                                        | Standard          |
| ------------------- | -------------------------------------------- | ----------------- |
| Runden              | 2 + Finale / 3 + Finale / nur Finale-Runden   | 2 + Finale        |
| Zeit zum Schreiben  | 60 / 90 / 120 s                              | 90 s              |
| Zeit zum Abstimmen  | 10 / 15 / 20 s                               | 15 s              |
| Kategorien          | Mehrfachauswahl                              | alle außer Ab 18  |
| Familienrunde       | an / aus                                     | aus               |
| Namen der Runde einsetzen | an / aus                               | aus               |
| Publikum            | an / aus                                     | an                |
| Sprachausgabe       | Bühne liest Satzanfang + Antworten vor (Browser-Stimme) | an      |
| 🍻 Trinkregeln       | Duell mit 0 Stimmen → 2 Schlucke, Pointe! → 3 verteilen | aus   |

Die **Sprachausgabe** (`speechSynthesis`) ist bei Quiplash die halbe Miete – eine trockene Computerstimme, die
Quatsch vorliest, ist lustig. Stimme/Tempo einstellbar, abschaltbar.

---

## 4. Bildschirme

### Laptop – Duell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 😂 Pointe! · Runde 1 · Duell 3/6                              ⏱ 12 s     │
├──────────────────────────────────────────────────────────────────────────┤
│        Der schlechteste Name für ein Kreuzfahrtschiff:                    │
│                                                                          │
│   ┌──────────────────────────┐       ┌──────────────────────────┐        │
│   │                          │  VS   │                          │        │
│   │    „Titanic 2“           │       │  „MS Seekrank“            │        │
│   │                          │       │                          │        │
│   └──────────────────────────┘       └──────────────────────────┘        │
│              abgestimmt: ●●●○○                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Auflösung:** Balken wachsen (*62 % · 38 %*), Avatare der Abstimmenden fliegen auf die Seite, Namen erscheinen.
Bei **Pointe!** großer Schriftzug + Konfetti.

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 😂 Satzanfang 1/2  ⏱ 71 s │  │ 😂 Welche ist besser?    │  │ 😂 Du bist im Duell!     │
│                         │  │                         │  │                         │
│ Der schlechteste Name   │  │ [ „Titanic 2“       ]   │  │   Schau auf den Laptop  │
│ für ein Kreuzfahrtschiff│  │                         │  │   und leide still. 😬    │
│                         │  │ [ „MS Seekrank“     ]   │  │                         │
│ [ Titanic 2        ]    │  │                         │  │                         │
│ [ Weiter → ] [ 🎲 ]      │  │                         │  │                         │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „🎤 Pointen-König/in“ (meiste Pointe!-Duelle), „🔥 Beste Antwort des Abends“ (meiste Stimmen in
Prozent, mit Text), „🦗 Grillenzirpen“ (Antwort mit 0 Stimmen), Rangliste mit Podest.

---

## 5. Technische Umsetzung

### Ordner

```
pointe/                         → https://tbnsuperkid.github.io/pointe/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/satzanfaenge/alltag.js …   Satzanfänge je Kategorie
  js/prompts.js                 einlesen, filtern, Namen einsetzen, ziehen ohne Wiederholung
  js/pairing.js                 Duelle verteilen: jede/r 2 Satzanfänge, 2 verschiedene Gegner
  js/speech.js                  Vorlesen (speechSynthesis, deutsche Stimme suchen)
  js/engine.js                  Runden, Schreiben, Duelle, Abstimmung, Punkte, Finale, Ansichten
  js/controllers.js             GameRoom.create({ game: 'pointe', net: 'pointe-v1-', storage: 'pointe', engine })
  js/app.js
tests/pointe.test.js
```

### Architektur

- Handys schicken `join`, `audience`, `answer` ({ promptId, text, rescue }), `vote`, `votes` (Finale), `hide` (Spielleitung), `next`.
- **Verteilung** (`pairing.js`): Personen im Kreis anordnen, Duell *i* = Person *i* gegen Person *i+1* – so hat jede/r
  genau 2 Duelle mit 2 verschiedenen Gegnern (bei 3 Personen zwangsläufig dieselben). In Runde 2 neu mischen.
- **Anonym:** In der Phase `vote` bekommen Handys und Bühne die Antworten **ohne** Autor. Die Seiten (links/rechts)
  werden pro Duell gemischt.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { rounds: 2, writeTime: 90, voteTime: 15, categories: […], family: false, names: false, audience: true, speech: true, drinks: false },
    players: [{ id, name, score, audience: false, stats: { pointes: 1, zero: 0, best: { text, pct } }, connected }],
    round: 1,
    duels: [{ prompt: { id, text }, a: 'p1', b: 'p2', answers: { p1: { text, rescue: false }, p2: … }, votes: { p3: 'a', … }, hidden: false }],
    current: 2,
    phase: 'lobby' | 'write' | 'duel' | 'result' | 'final-write' | 'final-vote' | 'final-result' | 'end'
  }
  ```

### Tests

- Verteilung für 3–10 Personen: jede/r genau 2 Satzanfänge, kein Duell gegen sich selbst, 2 verschiedene Gegner ab 4 Personen
- Nicht abstimmen im eigenen Duell, Publikumsanteil, leere Antwort verliert, Rettung halbiert
- Punkte pro Prozent, Pointe!-Bonus, Runde 2 doppelt, Finale 3 Stimmen (nicht für sich selbst)
- **Gefilterte Ansicht:** Autoren vor `result` unbekannt; eigene Satzanfänge nur für die beiden Duellierenden
- Inhalt: 600 Einträge, genau eine Lücke (Finale: 1–3), mind. 2 Rettungen

---

## 6. Umsetzung in Etappen

| Etappe | Inhalt                                                               | Ergebnis            |
| ------ | -------------------------------------------------------------------- | ------------------- |
| **1** ✅ | 200 Satzanfänge + `prompts.js` + `pairing.js` mit Tests                | Grundlage 📝         |
| **2** ✅ | Engine + Handys: Schreiben, Duelle, Abstimmung, Punkte, Karte auf der Startseite | Spielbar 😂 |
| **3** ✅ | Letzte Pointe, Publikum, Sprachausgabe, Statistik, Sounds              | Das volle Erlebnis   |
| **4** ✅ | auf 600 auffüllen, Ab 18, Namen einsetzen, Trinkregeln                  | Fertig 🎉            |

## 7. Entscheidungen (geklärt)

1. Name: **Pointe!**
2. Sprachausgabe: **standardmäßig an** (startet die Abstimmungszeit erst nach dem Vorlesen; als `shared/speech.js` für Werwolf/Bluff wiederverwendbar)
3. Namen der Mitspielenden: **erlaubt, Standard aus** (`{Spieler}` / `{Spielers}` für den Genitiv)
4. Runde 3 bei „3 + Finale“ zählt **dreifach**; „Nur Finale“ = **3 Runden** Letzte Pointe
5. Ab 18: **derb** (Sex, Party, Klo-Humor) – nur Erwachsene, nur einvernehmlich, nichts gegen Gruppen von Menschen

## 8. Stand der Umsetzung

- **697 Satzanfänge:** Alltag 156, Popkultur 104, Was wäre wenn 105, Namen 85, Arbeit & Schule 74, Ab 18 107, Finale 66
  (davon 38 mit `{Spieler}`, Finale mit 1–3 Lücken und „Erfinde ein Wort …“)
- Kleine Ergänzungen zum Plan: Zwischenstand nach jeder Runde; „alle fertig“ beendet das Schreiben sofort, sonst 1,5 s
  Gnadenfrist für die letzten Eingaben; das Handy schickt Getipptes bei Ablauf selbst ab; Rettungen in anderer Reihenfolge für
  die beiden im Duell; Auszeichnungen zusätzlich 🎲 Retter/in in der Not und 👑 Letzte Pointe; Trinkregeln auch im Finale
  (0 Stimmen → 2, beste Antwort verteilt 3); Leertaste / → schaltet auf der Bühne weiter.
- **Tests:** `tests/pointe.test.js` (40 Tests). Im Browser durchgespielt (stumm, Laptop + 4 Handys über den Node-Server):
  2 Runden + Letzte Pointe bis zur Siegerehrung, ohne Fehler in der Konsole.
