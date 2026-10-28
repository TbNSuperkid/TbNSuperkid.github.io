# 🎵 Hit Story – Planung

Angelehnt an **Hitster** (Jumbo, 2022): Ein Song läuft. Wer dran ist, muss ihn in seinen **eigenen Zeitstrahl**
einordnen – *kam der vor oder nach „Atemlos“ (2013)?* Liegt man richtig, bleibt die Karte liegen. Wer zuerst
**10 Karten** in seinem Zeitstrahl hat, gewinnt. Wer zusätzlich **Titel und Interpret** weiß, verdient **Joker**.

Der **Laptop** ist **Bühne und Lautsprecher**, die Handys zeigen den eigenen Zeitstrahl. Audio und Song-Datenbank
siehe **[musik-grundlagen.md](musik-grundlagen.md)** – kein Spotify (deren Regeln verbieten Spiele), stattdessen
iTunes-Ausschnitte oder „Selbst abspielen“.

> Name: **Hit Story** (Arbeitstitel war *Jahr raten*), Ordner `hit-story/`.

## Überblick

|                     | 🖥️ **Ein Gerät**                                   | 📱 **Mit Handys**                                    |
| ------------------- | ------------------------------------------------- | --------------------------------------------------- |
| **Song**             | Laptop spielt                                     | Laptop spielt                                        |
| **Zeitstrahl**       | alle Zeitstrahle nebeneinander auf dem Laptop      | eigener Zeitstrahl auf dem Handy, Bühne zeigt alle   |
| **Einordnen**        | Klick auf die Lücke                                | Antippen der Lücke auf dem Handy                     |
| **Titel/Interpret**  | laut, Spielleitung bestätigt                       | tippen, App prüft (`shared/titles.js`)                 |

- **2–10 Personen**, einzeln oder **Teams** (ein Zeitstrahl pro Team)
- Ziel: **10 Karten** (einstellbar)
- Aufwand: **Song-Datenbank mit korrekten Jahren** (gemeinsam mit den anderen Musikspielen) + Audio-Anbindung

---

## 1. Regeln

### Start

Jede Person bekommt **eine offene Startkarte** (Song + Jahr) und **2 Joker** 🪙.

### Ablauf eines Zuges

1. **Song läuft** (30 s Ausschnitt oder „Selbst abspielen“). Niemand sieht Titel oder Jahr.
2. **Einordnen:** Die Person am Zug wählt die **Lücke** in ihrem Zeitstrahl (*vor 1985 · 1985–2013 · nach 2013*).
3. **Bonus:** Wer will, tippt **Titel und Interpret**. Beides richtig → **+1 Joker** (max. 5).
4. **Einspruch („Daneben!“):** Alle anderen dürfen **1 Joker** einsetzen und die Karte in **ihrer Meinung nach richtige
   Lücke im Zeitstrahl der aktiven Person** legen. (Mehrere Einsprüche: wer zuerst drückt.)
5. **Auflösung:** Jahr wird gezeigt.
   - Aktive Person richtig → Karte bleibt bei ihr.
   - Falsch, aber ein Einspruch war richtig → die **Einspruch-Person** bekommt die Karte (in ihren eigenen Zeitstrahl,
     an die richtige Stelle).
   - Sonst → Karte weg.
6. **Gleiches Jahr** wie eine Nachbarkarte → beide Seiten zählen als richtig.

**Joker** außerdem einsetzbar für: **Song überspringen** (neuer Song, bevor man einordnet) oder **3 Joker → 1 Karte
gratis** (wird automatisch richtig eingeordnet).

### Spielende

Wer zuerst **10 Karten** (Startkarte zählt mit) hat, gewinnt. Die Runde wird zu Ende gespielt, damit alle gleich
oft dran waren; bei Gleichstand gewinnt, wer mehr Joker hat.

---

## 2. Varianten

| Variante         | Regel                                                                |
| ---------------- | -------------------------------------------------------------------- |
| 🟢 **Leicht**     | Lücke nur grob: *vor/nach* einer einzigen Karte (z. B. Kinder, Gelegenheitshörer) |
| 🔴 **Profi**      | Titel + Interpret **Pflicht**, sonst gilt die Karte nicht             |
| 🤝 **Kooperativ** | Ein gemeinsamer Zeitstrahl, 10 Karten schaffen, bevor 3 Fehler passieren |
| 🎯 **Jahr genau** | Statt Lücke das **Jahr tippen**: genau = 3, ±1 = 2, ±3 = 1 Punkt (spielt sich wie Pi mal Daumen) |

---

## 3. Songs

Gemeinsame Datenbank aus [musik-grundlagen.md](musik-grundlagen.md) (Ziel 600 Songs). Für Jahr raten wichtig:

- **Gleichmäßige Verteilung** 1960–heute, sonst stapelt sich alles in den 2000ern. Filter nach Jahrzehnten.
- Das **Jahr muss stimmen**: erste Veröffentlichung der bekannten Version, **Single oder Album – was früher war**
  (*Hotel California* = 1976, nicht 1977; *Billie Jean* = 1982). Keine Remaster-, Best-of- oder Neuauflagen-Jahre.
  Test: Jahr im Bereich, Stichproben-Liste bekannter Fallen (Neuauflagen, späte Chart-Hits wie *Running Up That Hill*,
  Coverversionen → *die bekannte Version* zählt, Interpret steht dabei). Unsichere Jahre lieber weglassen.
- **Coverversionen** nur, wenn die Cover-Version die bekannte ist (Jahr der Cover-Version).

---

## 4. Einstellungen

| Option              | Werte                                         | Standard        |
| ------------------- | --------------------------------------------- | --------------- |
| Audio               | iTunes-Ausschnitte / Selbst abspielen         | iTunes          |
| Ziel                | 5 / 10 / 15 Karten                            | 10              |
| Joker am Start      | 0 / 2 / 3                                     | 2               |
| Jahrzehnte          | Mehrfachauswahl                               | alle            |
| Kategorien          | Mehrfachauswahl (Charts, Deutsch, Schlager …) | alle            |
| Variante            | Normal / Leicht / Profi / Kooperativ / Jahr genau | Normal       |
| Teams               | aus / 2–4                                     | aus             |
| 🍻 Trinkregeln       | falsch eingeordnet → 1 Schluck, Einspruch erfolgreich → Verlierer 2 | aus |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🎵 Jahr raten · Anna ist dran                    🔊 ▶ ███████░░░ 0:21     │
├──────────────────────────────────────────────────────────────────────────┤
│   Anna 🪙🪙   │1982│      │1999│      │2013│        ← ? (wählt …)          │
│   Ben  🪙     │1977│ │1991│ │2004│ │2008│ │2019│                          │
│   Cem  🪙🪙🪙  │1969│ │2010│                                               │
│                                                                          │
│   Einspruch möglich: ✋ Ben  (noch 8 s)                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**Auflösung:** Karte dreht sich um: *„Tainted Love – Soft Cell – **1981**“*, Store-Link klein darunter
(Bedingung der iTunes-Ausschnitte), Karte fliegt an ihren Platz oder zerfällt.

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ 🎵 Du bist dran           │  │ 🎵 Anna ordnet ein        │
│ Wo gehört der Song hin? │  │                         │
│ [ ← vor 1982 ]           │  │ Annas Zeitstrahl:       │
│ │1982│                   │  │ 1982 · 1999 · 2013      │
│ [ 1982 – 1999 ]          │  │                         │
│ │1999│                   │  │ [ ✋ Daneben! (1 🪙) ]    │
│ [ 1999 – 2013 ] ✓        │  │                         │
│ │2013│                   │  │                         │
│ [ nach 2013 → ]          │  │                         │
│ Titel [        ] 🪙 +1   │  │                         │
└─────────────────────────┘  └─────────────────────────┘
```

**Statistik am Ende:** „🕰️ Zeitreisende/r“ (meiste richtige Einordnungen in Folge), „🎧 Musiklexikon“ (meiste Titel
erkannt), „✋ Besserwisser/in“ (erfolgreichste Einsprüche) und die **Playlist des Abends** (alle gespielten Songs mit
Store-Links).

---

## 6. Technische Umsetzung

### Ordner

```
hit-story/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/timeline.js                Lücken berechnen, richtig/falsch (gleiches Jahr = richtig), Einsortieren
  js/engine.js                  Züge, Joker, Einspruch, Auflösung, Spielende, Varianten, Ansichten
  js/controllers.js             GameRoom.create({ game: 'hit-story', net: 'hitstory-v1-', storage: 'hitstory', engine })
  js/app.js
shared/songs/*.js, shared/songs.js, shared/titles.js, shared/audio-source.js   (siehe musik-grundlagen.md)
tests/songs.test.js           Song-Datenbank (Etappe 1 ✅)
tests/hit-story.test.js       Zeitstrahl, Titel, Engine (ein Gerät, Handys, Varianten), Audio, Seite
```

### Architektur

- Handys schicken `join`, `place` (Lücke), `name` (Titel/Interpret), `challenge` (+ Lücke), `skip` (Joker), `buy`, `next`.
- **`viewFor(pid)`**: Titel, Interpret, Jahr und Audio-URL des laufenden Songs **nie** an Handys vor der Auflösung.
  Die Bühne zeigt sie ebenfalls erst bei `reveal`.
- Audio: Bühne holt vor jedem Zug den Ausschnitt über `AudioSource`, lädt **den nächsten Song schon vor** (keine Pause).
  Kein Treffer → nächster Song, ohne dass jemand etwas merkt.

### Tests

- Lücken: Anfang, Mitte, Ende, gleiche Jahre nebeneinander, gleiches Jahr wie der Song
- Einspruch: richtig/falsch, mehrere Einsprüche (erster zählt), Joker-Abzug, Karte wandert zur Einspruch-Person
- Joker: max. 5, überspringen, 3 → 1 Karte
- Spielende: Runde wird zu Ende gespielt, Gleichstand
- **Gefilterte Ansicht:** Song-Daten vor `reveal` auf keinem Handy

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                   | Ergebnis         |
| ------ | ------------------------------------------------------------------------ | ---------------- |
| **1** ✅ | Song-Datenbank (erst 200 Songs, Jahre geprüft) + `shared/songs.js` + Tests | Grundlage 🎶      |
| **2** ✅ | „Selbst abspielen“ + Ein Gerät: Zeitstrahle, Einordnen, Auflösung         | Spielbar ohne Audio-API 🎵 |
| **3** ✅ | `AudioSource.itunes`, Handys, Joker, Einspruch, Titel prüfen               | Das volle Erlebnis 📱 |
| **4** ✅ | 600 Songs, Varianten, Teams, Statistik, Playlist des Abends                | Fertig 🎉         |

### Stand Etappe 1 ✅

- **372 Songs** in `shared/songs/` (7 Kategorien: `klassiker-vor-1980`, `charts-80er` … `charts-2020er`, `deutsch`),
  50er 6 · 60er 41 · 70er 48 · 80er 70 · 90er 61 · 2000er 57 · 2010er 57 · 2020er 32
- `shared/songs.js` (`window.Songs`): `parseLine`, `list`, `byId`, `filter({ cats, decades, level })`,
  `draw(songs, used, { spread })` – zieht erst ein Jahrzehnt, dann einen Song daraus, damit sich nicht alles in den
  80ern stapelt – und `stats()`
- `tests/songs.test.js`: jede Zeile gültig, keine Doppelten, Jahr passt zur Kategorie, Jahrzehnte gleichmäßig,
  25 Stichproben bekannter Fallen, Filtern und Ziehen
- Noch offen für spätere Etappen: Kategorien `schlager-party`, `rock`, `hiphop`, `film-serie`, Titel-Übersetzungen
  und Beschreibungen (für Übersetzte Lyrics), Ausbau auf 600 Songs

### Stand Etappe 2 ✅

- `hit-story/` als **Ein-Gerät-Spiel** (Laptop oder Handy in der Mitte), Karte auf der Startseite, `PUBLIC_DIRS`, `npm test`
- **„Selbst abspielen“** (`shared/audio-source.js`, `AudioSource.manual` + `searchLinks`): DJ-Fenster *„Nur für Ben – alle
  anderen wegschauen“* mit Titel + Interpret (ohne Jahr), Such-Links und **QR-Code** für Spotify / YouTube / Apple Music
  (nur Such-URLs, keine API), *„🔄 Anderer Song“* ohne Folgen
- **DJ:** reihum die Person **vor** der aktiven (kennt die Lösung, ist aber nicht dran) oder Spielleitung, die nicht mitspielt
- `js/timeline.js`: Lücken, `fits`/`correctGaps` (gleiches Jahr = beide Seiten richtig), `insert` an der gewählten Lücke,
  Beschriftung *vor 1985 · 1985 – 2013 · nach 2013 · auch 1983*
- `js/engine.js`: Startkarten, reihum, Lücke wählen (umentscheiden erlaubt), Auflösen, Runde zu Ende spielen, Gleichstand
  teilt den Sieg, Songs gehen aus → Ende, keine Wiederholung im Spiel und am Abend, Revanche, Spielstand speichern
- Einstellungen: Ziel 5/10/15, DJ, Jahrzehnte und Kategorien (Mehrfachauswahl mit Song-Anzahl, mind. 20 Songs),
  Songs-Stufe, 🍻 Trinkregeln
- Siegerehrung: Rangliste, 🕰️ Zeitreise (längste Serie), alle Zeitstrahle, **Playlist des Abends** (vorgezogen aus Etappe 4)
- `tests/hit-story.test.js`: 34 Tests (Lücken, Einordnen, reihum/DJ, Spielende, Abend-Topf, Seite lädt alle Song-Dateien)
- Bewusst noch nicht: Joker (Titel-Bonus, Überspringen, Kaufen), Einspruch, Tie-Break über Joker – kommen mit Etappe 3

### Stand Etappe 3 ✅

- **Engine im GameRoom-Format** (`apply`, `viewFor`, `connect` …) für beide Spielweisen: 📱 Handys (Lobby, QR, Wiederverbinden,
  erstes Handy = 🎬 Spielleitung) und 🖥️ ein Gerät (startet sofort, läuft ohne Raum). Spielstand im Browser, Weiterspielen.
- **`AudioSource.itunes`** (`shared/audio-source.js`): iTunes-Suche mit `country=de` (CORS erlaubt), Treffer nur bei passendem
  Interpreten **und** Titel, ohne Live-/Karaoke-/Remix-/Cover-Fassungen, das Jahr am nächsten am Original gewinnt.
  Zwischenspeicher 7 Tage („nichts gefunden“ 1 Tag). Die Bühne lädt den **nächsten Song schon vor** (`nextSong`), ohne Treffer
  kommt per `replace` unbemerkt der nächste. Netzfehler/Rate-Limit → für diesen Song „Selbst abspielen“. Autoplay-Sperre: der
  Start-Klick schaltet den Ton frei, sonst „▶ Abspielen“. Bei jeder Auflösung und in der Playlist: **„In Apple Music öffnen“**.
  Stichproben: 76 von 78 Songs haben einen passenden Ausschnitt (die zwei übrigen: ein Rate-Limit, einmal kein Treffer).
- **Selbst abspielen mit Handys:** Das **DJ-Handy** bekommt Titel + Interpret (nie das Jahr) und Such-Links zur eigenen App;
  der DJ darf Songs ersetzen, aber keinen Einspruch einlegen.
- **`shared/titles.js`** (aus Schlecht erklärt ausgelagert, `SETitles` bleibt als alter Name): `checkSong`, `checkTitle`
  (Klammerzusätze egal), `checkArtist` (jede/r Beteiligte bei feat./&/und/x, auch nur der hintere Namensteil: „Gaga“, „Bowie“).
- **Joker:** Titel + Interpret → +1 (höchstens 5; am Handy automatisch geprüft, Spielleitung kann korrigieren, ein Gerät: laut
  sagen + bestätigen) · überspringen 1 · Karte gratis 3 · **Einspruch** 1: 10 s Einspruch-Zeit (Restzeit statt Uhrzeit, die
  Handy-Uhren gehen nicht gleich), wer zuerst drückt, zählt, bei Erfolg wandert die Karte. Verbucht wird erst beim „Weiter“.
- **Gefilterte Ansicht** getestet: vor der Auflösung kein Titel, Interpret, Jahr, keine ID auf einem Handy; den eigenen
  Titel-Tipp sieht nur das eigene Team.

### Stand Etappe 4 ✅

- **678 Songs** (Ziel 600) in 11 Kategorien, neu: `rock` (82), `hiphop` (51), `schlager-party` (49), `film-serie` (40) –
  50er 16 · 60er 78 · 70er 98 · 80er 121 · 90er 108 · 2000er 114 · 2010er 95 · 2020er 48, 35 % „kennt jede/r“.
  38 Stichproben bekannter Fallen (u. a. *Rockin' All Over the World* 1977, *Axel F* 1984 vs. Crazy Frog 2005,
  *Beggin'* 2017, *Bloody Mary* 2011, *Do You Love Me* 1962). Unsichere Jahre wurden weggelassen.
- **Varianten:** 🟢 Leicht (Vergleichskarte zufällig aus dem eigenen Zeitstrahl, die Karte landet an der richtigen Stelle) ·
  🔴 Profi · 🤝 Kooperativ (ein Team aus allen, reihum tippen, 3 Fehler) · 🎯 Jahr genau (Ziel × 2 in Punkten, die Karte
  kommt zur Erinnerung in den Zeitstrahl, kein Einspruch).
- **Teams** 2–4 mit Handys: ausgeglichen verteilt, Wechsel in der Lobby (Handy oder Laptop), jedes Mitglied darf für das Team
  handeln, angezeigt wird, wer gerade tippt (wechselt ab).
- **Statistik:** Rangliste (Karten/Punkte, Joker entscheiden bei Gleichstand), 🕰️ Zeitreise, 🎧 Musiklexikon, ✋ Besserwisser,
  alle Zeitstrahle, **Playlist des Abends** mit Store- bzw. Such-Links. Nach dem Spiel: Revanche oder zurück in die Lobby.
- Bewusst nicht: Titel-Übersetzungen und Beschreibungen in der Datenbank – die braucht erst *Übersetzte Lyrics*.

### Ausbau auf 1000+ Songs ✅

- **1081 Songs** in 12 Kategorien, neu `deutschrap` (110: 187 Strassenbande mit Bonez MC, RAF Camora, Gzuz, Maxwell, LX, Sa4 –
  dazu BHZ, Apsilon, makko, RIN, Pashanim, Ski Aggu, Cro, Capital Bra, Apache 207, Ufo361, Shirin David, Ayliva …),
  mehr Deutsch-Pop (Nina Chuba, AnnenMayKantereit, Kraftklub, Silbermond, Zartmann …), Red Hot Chili Peppers, Linkin Park,
  Oasis, Kanye West, Oliver Tree, aktuelle Hits bis 2025 und die Titel aus drei Spotify-Playlists (je die ersten 100 Titel,
  obskure Füllsongs und Cast-Fassungen weggelassen).
- **Jahre geprüft:** jedes neue Jahr gegen das früheste Erscheinungsjahr der iTunes-Suche abgeglichen; bei Abweichungen
  einzeln entschieden (iTunes datiert alte Songs oft auf Sammlungen), unsichere Songs gestrichen. 11 neue Fallen im Test.
- **Ohne Ausschnitt:** Einige Deutschrap-Hits (*Palmen aus Plastik*, *Ohne mein Team*, *500 PS*, *Neymar*, *Tilidin*,
  *Friesenjung*) gibt es in keinem iTunes-Store als Gesangsversion – im Ausschnitt-Modus werden sie übersprungen, mit
  „Selbst abspielen“ laufen sie normal.
- 50er 17 · 60er 111 · 70er 118 · 80er 145 · 90er 127 · 2000er 178 · 2010er 221 · 2020er 164; Stufe 1 jetzt 26 % (283 Songs) –
  der Test verlangt mindestens 250 und 25 %, Deutschrap und neue Hits sind bewusst oft Stufe 2–3.

## 8. Offene Entscheidungen

Siehe [musik-grundlagen.md](musik-grundlagen.md) (ein Spiel oder vier, Audio-Quelle). Außerdem:

1. ~~Name~~ → **Hit Story**
2. ~~Einspruch gratis oder mit Joker?~~ → **kostet 1 Joker**, wer zuerst drückt, zählt (der DJ darf nicht)
