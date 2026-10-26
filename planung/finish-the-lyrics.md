# 🎤 Finish the lyrics – Planung

Ein Song wird **angespielt oder angesungen** – und bricht mitten in der Zeile ab:

> 🎶 *„Atemlos durch die Nacht, …“* → **?**

Wer die **Fortsetzung** weiß, singt (oder tippt) sie. Bekannt aus Shows wie *„Don't Forget the Lyrics!“* und als
Partyspiel.

⚠️ **Songtexte sind urheberrechtlich geschützt** – wir können keine Text-Datenbank auf die öffentliche Seite
stellen. Deshalb ist das Spiel so gebaut, dass die **Texte nie im Repo stehen** (Details:
**[musik-grundlagen.md](musik-grundlagen.md)**, Abschnitt 2).

> Name: **Finish the lyrics** (dein Vorschlag), Ordner `finish-the-lyrics/` bzw. Modus in `musikabend/`.

## Überblick: 3 Spielweisen ohne veröffentlichte Texte

|                         | 🔊 **Audio stoppt**                          | 🎙️ **Ansingen**                              | 📦 **Eigenes Paket**                          |
| ----------------------- | ------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| Woher kommt der Anfang? | iTunes-Ausschnitt vom Laptop, stoppt plötzlich | Spielleitung/Person singt an (Titel kommt aufs Handy) | Text aus einer Datei, die **ihr selbst** anlegt |
| Woher kommt die Lösung? | Ausschnitt läuft weiter                     | die ansingende Person / alle singen mit     | aus der Datei                                |
| Wer bewertet?           | die Runde (👍/👎) oder Spielleitung          | die Runde                                    | App vergleicht getippte Antworten            |
| Text im Repo?           | ❌ nein                                      | ❌ nein                                       | ❌ nein (nur im eigenen Browser)              |

- **2–12 Personen**, einzeln oder **Teams** (Teams sind hier lustiger – man singt zusammen)
- **10 / 15 / 20 Songs**
- Aufwand: **Stoppstellen** (Zeit im Ausschnitt, kein Text!), **Bewertung durch die Runde**, **Paket-Editor**

---

## 1. 🔊 Audio stoppt (Standard)

1. Der Laptop spielt einen 30-s-Ausschnitt (siehe [musik-grundlagen.md](musik-grundlagen.md)) und **stoppt** an einer
   **Stoppstelle**. Die Stoppstelle ist eine **Zeit in Sekunden** in der Datenbank (*„stoppe bei 12,4 s“*) – also kein
   Text, nur eine Zahl. Gibt es keine, stoppt die App zufällig zwischen 8 und 20 s.
2. Das Team/die Person am Zug **singt weiter** (10 s).
3. **Auflösung:** Ausschnitt läuft ab der Stoppstelle weiter – alle hören, ob es stimmte.
4. **Bewertung:** Alle anderen stimmen per Handy ab: **👍 richtig · 🤏 fast · 👎 falsch** → 3 / 1 / 0 Punkte.
   Bei Teams: Das andere Team bewertet, die Spielleitung kann überstimmen.

**Variante Alle gleichzeitig:** Alle tippen die Fortsetzung auf dem Handy (ein paar Wörter reichen), Bühne zeigt nach
dem Weiterlaufen alle Antworten, die Runde vergibt 👍. Am lustigsten bei Verhörern.

> **Stoppstellen pflegen:** Im Spiel gibt es für die Spielleitung einen Knopf *„📍 Hier wäre eine gute Stelle“* –
> der speichert die aktuelle Zeit des Ausschnitts lokal. Gesammelte Stellen kann man als Liste kopieren und in die
> Datenbank übernehmen (wie *👎 Melden* bei Schlecht erklärt).

---

## 2. 🎙️ Ansingen (ganz ohne Audio)

1. Reihum ist eine Person **Ansänger/in**. Ihr Handy zeigt **Titel + Interpret** von 3 Songs zur Auswahl.
2. Sie singt **den Anfang einer Zeile** und hört auf.
3. Alle anderen (oder das gegnerische Team) singen weiter. Wer zuerst richtig weitersingt, drückt **✋** auf dem Handy –
   die Ansänger/in bestätigt ✅.
4. Punkte: **2** für den Treffer, **1** für die Ansänger/in, wenn es mindestens eine/r wusste.

---

## 3. 📦 Eigenes Paket (Texte nur lokal)

Für Leute, die Texte selbst eintragen wollen – z. B. zehn Lieblingssongs der Gruppe:

- **Editor** wie bei Who knows more? (`who-knows-more/js/editor.js` als Vorbild): Song, Anfang der Zeile, Fortsetzung.
- Gespeichert **nur im Browser** (`localStorage`) und als **Datei exportierbar/importierbar** (`.json`), damit man es
  in der Gruppe teilen kann. Es gibt **keine** mitgelieferten Pakete.
- Gespielt wird mit Tippen: Fortsetzung tippen, App vergleicht mit `shared/match.js` (Wort für Wort, Satzzeichen egal,
  Anteil richtiger Wörter → 3 / 2 / 1 / 0 Punkte), Runde kann überstimmen.
- Hinweis im Editor: *„Texte sind geschützt – Pakete nur privat nutzen und nicht veröffentlichen.“*

---

## 4. Einstellungen

| Option             | Werte                                          | Standard     |
| ------------------ | ---------------------------------------------- | ------------ |
| Spielweise         | Audio stoppt / Ansingen / Eigenes Paket        | Audio stoppt |
| Wer antwortet      | reihum / Teams abwechselnd / alle gleichzeitig | Teams abwechselnd |
| Anzahl Songs       | 10 / 15 / 20                                   | 15           |
| Zeit zum Weitersingen | 10 / 15 / 20 s                              | 10 s         |
| Kategorien         | Deutsch, Schlager & Party, Charts, Kinderlieder … | Deutsch + Schlager (die kennt man am besten) |
| 🍻 Trinkregeln      | 👎 → 1 Schluck, 3 × 👍 hintereinander → 2 verteilen | aus      |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🎤 Finish the lyrics · Song 6/15 · Team 🔵 ist dran          🔵 9 : 7 🟠  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│        🎶 Atemlos durch die Nacht – Helene Fischer                        │
│                                                                          │
│        ▶▶▶▶▶▶▶▶▶▶▶▶▶ ⏸   (gestoppt)                                        │
│                                                                          │
│        🎤 Jetzt weitersingen!          ⏱ 7 s                              │
│                                                                          │
│        [ ▶ Auflösen (weiterlaufen lassen) ]                                │
└──────────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ 🎤 Hat Team 🔵 es richtig? │  │ 🎙️ Du singst an!          │
│                         │  │ Such dir einen aus:     │
│   [ 👍 richtig ]          │  │ [ Atemlos – H. Fischer ] │
│   [ 🤏 fast    ]          │  │ [ 99 Luftballons – Nena] │
│   [ 👎 falsch  ]          │  │ [ Kenn ich nicht ↻ ]     │
│                         │  │ Sing eine Zeile an und  │
│                         │  │ hör mittendrin auf!     │
└─────────────────────────┘  └─────────────────────────┘
```

---

## 6. Technische Umsetzung

### Ordner

```
finish-the-lyrics/  (oder musikabend/ mit Modus „lyrics“)
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/stops.js                   Stoppstellen (Song-ID → Sekunden), zufällige Stelle, „📍 gute Stelle“ sammeln
  js/packs.js                   Eigene Pakete: Editor, localStorage, Export/Import, Vergleich Wort für Wort
  js/engine.js                  Reihum/Teams, Phasen, Bewertung durch die Runde, Punkte, Ansichten
  js/controllers.js             GameRoom.create({ game: 'finish-the-lyrics', net: 'finishlyrics-v1-', storage: 'finishlyrics', engine })
  js/app.js
shared/songs/*, shared/songs.js, shared/audio-source.js
tests/finish-the-lyrics.test.js
```

- Die Song-Datenbank bekommt **ein optionales Feld** `stop` (Sekunden im iTunes-Ausschnitt). Achtung: Wechselt Apple
  den Ausschnitt, passt die Stelle nicht mehr → dann zufällige Stelle.
- **`viewFor(pid)`**: Titel nur an Ansänger/in; bei Eigenen Paketen die Fortsetzung nie vor der Auflösung.

### Tests

- Bewertung: Mehrheit 👍/🤏/👎, Gleichstand, Spielleitung überstimmt, Team bewertet nicht sich selbst
- Paket-Vergleich: Satzzeichen, Groß/klein, fehlende Füllwörter, Anteil richtiger Wörter → Punkte
- Export/Import: Datei rein → gleiches Paket raus, kaputte Datei → Fehlermeldung
- Inhalts-Test: **kein Feld mit Liedtext** in `shared/songs/` (z. B. keine Felder über 120 Zeichen außer Beschreibung)

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                | Ergebnis              |
| ------ | --------------------------------------------------------------------- | --------------------- |
| **1**  | **Ansingen** mit Handys (nutzt nur die Song-Datenbank), Karte auf der Startseite | Spielbar ohne Audio 🎙️ |
| **2**  | **Audio stoppt** mit zufälliger Stelle, Bewertung, Teams                | Mit Musik 🔊           |
| **3**  | Stoppstellen sammeln/pflegen, Alle gleichzeitig, Eigene Pakete mit Editor | Fertig 🎉            |

## 8. Offene Entscheidungen

Siehe [musik-grundlagen.md](musik-grundlagen.md). Außerdem:

1. Eigene Pakete überhaupt anbieten?
2. Standard **Teams** oder **reihum einzeln**?
