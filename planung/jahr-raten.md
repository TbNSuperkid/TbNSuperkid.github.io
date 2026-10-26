# 🎵 Jahr raten – Planung

Angelehnt an **Hitster** (Jumbo, 2022): Ein Song läuft. Wer dran ist, muss ihn in seinen **eigenen Zeitstrahl**
einordnen – *kam der vor oder nach „Atemlos“ (2013)?* Liegt man richtig, bleibt die Karte liegen. Wer zuerst
**10 Karten** in seinem Zeitstrahl hat, gewinnt. Wer zusätzlich **Titel und Interpret** weiß, verdient **Joker**.

Der **Laptop** ist **Bühne und Lautsprecher**, die Handys zeigen den eigenen Zeitstrahl. Audio und Song-Datenbank
siehe **[musik-grundlagen.md](musik-grundlagen.md)** – kein Spotify (deren Regeln verbieten Spiele), stattdessen
iTunes-Ausschnitte oder „Selbst abspielen“.

> Name: Arbeitstitel **Jahr raten**, Ordner `jahr-raten/` bzw. Modus in `musikabend/` (Alternativen: *Zeitreise*,
> *Hitparade*, *Wann war das?*).

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
- Das **Jahr muss stimmen** (Erstveröffentlichung). Test: Jahr im Bereich, keine Remaster-Jahre (Stichproben-Liste
  bekannter Fallen wie Neuauflagen, Coverversionen → *die bekannte Version* zählt, Interpret steht dabei).
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
jahr-raten/  (oder musikabend/ mit Modus „jahr“)
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/timeline.js                Lücken berechnen, richtig/falsch (gleiches Jahr = richtig), Einsortieren
  js/engine.js                  Züge, Joker, Einspruch, Auflösung, Spielende, Varianten, Ansichten
  js/controllers.js             GameRoom.create({ game: 'jahr-raten', net: 'jahrraten-v1-', storage: 'jahrraten', engine })
  js/app.js
shared/songs/*.js, shared/songs.js, shared/titles.js, shared/audio-source.js   (siehe musik-grundlagen.md)
tests/jahr-raten.test.js
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
| **1**  | Song-Datenbank (erst 200 Songs, Jahre geprüft) + `shared/songs.js` + Tests | Grundlage 🎶      |
| **2**  | „Selbst abspielen“ + Ein Gerät: Zeitstrahle, Einordnen, Auflösung         | Spielbar ohne Audio-API 🎵 |
| **3**  | `AudioSource.itunes`, Handys, Joker, Einspruch, Titel prüfen               | Das volle Erlebnis 📱 |
| **4**  | 600 Songs, Varianten, Teams, Statistik, Playlist des Abends                | Fertig 🎉         |

## 8. Offene Entscheidungen

Siehe [musik-grundlagen.md](musik-grundlagen.md) (ein Spiel oder vier, Audio-Quelle). Außerdem:

1. Name: **Jahr raten** oder etwas Eigenes?
2. Einspruch kostet einen Joker – oder ist er gratis, aber nur einmal pro Zug für alle?
