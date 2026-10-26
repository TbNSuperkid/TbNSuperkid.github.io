# 💣 Wortbombe – Planung

Angelehnt an **Tick Tack Bumm** (Piatnik) und *Pass the Bomb*: Ein Handy ist die **Bombe**. Es zeigt eine Aufgabe –
*„Ein Wort mit **-ung**“* oder *„Etwas, das man im Supermarkt kauft“* – und **tickt**. Wer die Bombe hat, nennt
ein passendes Wort und gibt das Handy **schnell weiter**. Irgendwann – **zufällig**, niemand weiß wann – macht es
**BUMM**. Wer die Bombe dann in der Hand hält, verliert die Runde.

Ein **Gerät reicht**, kein Laptop, keine Handys der anderen. Perfekt zum Aufwärmen, für unterwegs und als Trinkspiel.

> Name: Arbeitstitel **Wortbombe**, Ordner `wortbombe/` (Alternativen: *Tick Tack*, *Zündschnur*).

## Überblick

- **2–12 Personen**, im Kreis sitzend
- **Ein Gerät** (Handy/Tablet), das herumgereicht wird
- Pro Runde ein Verlierer → **Strafpunkt**. Wer zuerst **3** hat, scheidet aus (oder: nach 10 Runden zählen)
- Aufwand sehr gering: **Silben/Kategorien-Listen** und eine **gute Bombe** (Ticken, Spannung, Knall)

---

## 1. Regeln

1. **Aufgabe** erscheint groß (Silbe oder Kategorie, Modus siehe unten). Die Person, die startet, drückt **▶ Zünden**.
2. Die Bombe tickt. Wer sie hat, nennt ein **passendes Wort**, das in dieser Runde **noch nicht genannt** wurde, und
   **tippt aufs Display** (= Weitergeben). Erst dann darf die nächste Person übernehmen. (Ohne Tipp gilt sie nicht
   als weitergegeben – das verhindert Schummeln durch Wegwerfen.)
3. Die **Zündschnur** ist zufällig **10–60 s** lang (einstellbar). Das Ticken wird gegen Ende schneller – aber **nicht
   verlässlich** (manchmal bleibt es lange schnell, manchmal knallt es ohne Beschleunigung).
4. **BUMM** 💥: **Wer die Bombe hält, bekommt einen Strafpunkt** – ohne Diskussion. Ungültige Wörter darf die Gruppe
   nur **während** der Runde ablehnen (*„Gilt nicht!“* → die Person muss ein neues Wort sagen, bevor sie weitergibt).
5. Nächste Runde startet die Person, die verloren hat.

### Modi

| Modus             | Aufgabe                                     | Beispiel                                  |
| ----------------- | ------------------------------------------- | ----------------------------------------- |
| 🔤 **Silbe**       | Wort, das die Silbe **enthält**               | *-ung, schl-, -ei-, -tt-, auto-*           |
| ▶️ **Anfang**      | Wort, das mit … **beginnt**                  | *Ver-, Kr-, Sch-*                          |
| ◀️ **Ende**        | Wort, das auf … **endet**                    | *-chen, -heit, -ig*                        |
| 📦 **Kategorie**   | Begriff aus einer Kategorie                  | *Automarken, Dinge im Bad, Pizzabeläge*    |
| 🔗 **Kette**       | Wort, das mit dem **letzten Buchstaben** des vorigen beginnt | *Haus → Sonne → Esel …* (vorherige Person sagt laut) |
| 🎲 **Gemischt**    | jede Runde zufällig einer der Modi            |                                            |

---

## 2. Inhalte

| Datei            | Inhalt                                                             | Ziel |
| ---------------- | ------------------------------------------------------------------ | ---- |
| `silben.js`      | Silben/Buchstabenfolgen mit **Stufe** (leicht: *-er-*, schwer: *-pf-*, *-xi-*) | 200 |
| `anfang-ende.js` | Wortanfänge/-enden                                                  | 120  |
| `kategorien.js`  | Kategorien (familientauglich + *Ab 18*)                              | 300  |

- **Stufe** bestimmen: Für jede Silbe zählen, wie viele Wörter einer **freien deutschen Wortliste** sie enthalten
  (einmalig mit einem kleinen Skript in `tests/` oder `scripts/`, die Liste selbst kommt **nicht** ins Spiel).
  Viele Wörter = leicht. So sind die Stufen ehrlich.
- Kategorien mit **genug Antworten** (mind. ~20, sonst ist die Runde nach 6 Wörtern unfair)

---

## 3. Die Bombe 💣 (Kernstück)

- **Ton** über `GameFx.synth` (`shared/fx.js`): Ticken als kurzer Klick, Tempo von ~1/s bis ~6/s, dazu ein
  leises Zischen der Zündschnur. Der **Knall**: tiefes Rauschen + Bass, Bildschirm blitzt rot/weiß, **Vibration**.
- **Zufall:** Zündzeit = gleichmäßig zwischen *min* und *max*. Beschleunigung startet zu einem **zufälligen Anteil**
  (40–90 %) der Zeit – so kann man nicht aus dem Tempo rechnen.
- **Display:** Zündschnur-Animation, die **nicht** die echte Restzeit zeigt (brennt ungleichmäßig, Funken).
- **Wake Lock**, damit das Handy nicht ausgeht; **Ton-Erlaubnis** beim ersten Tipp (iOS).
- **Fallen lassen vermeiden:** großer Tipp-Bereich über das ganze Display, Hinweis *„Gut festhalten!“* 😄

---

## 4. Einstellungen

| Option             | Werte                                   | Standard          |
| ------------------ | --------------------------------------- | ----------------- |
| Modus              | Silbe / Anfang / Ende / Kategorie / Kette / Gemischt | Gemischt |
| Schwierigkeit      | leicht / mittel / schwer                | mittel            |
| Zündschnur         | kurz (10–30 s) / normal (15–60 s) / lang (30–90 s) | normal |
| Ausscheiden        | 3 Strafpunkte / ohne (10 Runden zählen) | 3 Strafpunkte     |
| Namen eintragen    | an / aus (dann nur Zählen der Runden)    | an                |
| Ab 18 (Kategorien) | an / aus                                | aus               |
| 🍻 Trinkregeln      | BUMM → 1 Schluck, 3. Strafpunkt → 3 Schlucke | aus            |

---

## 5. Bildschirme

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 💣 Runde 4               │  │ 💣  tick … tick …         │  │       💥 B U M M 💥       │
│                         │  │                         │  │                         │
│   Ein Wort mit           │  │        – U N G –          │  │   Ben hatte die Bombe!  │
│                         │  │                         │  │                         │
│      – U N G –           │  │     ~~~~~~~*✨            │  │   Strafpunkte:          │
│                         │  │     (Zündschnur)        │  │   Ben ●●○  Anna ●○○      │
│   [ ▶ Zünden ]           │  │  Tippen = weitergeben    │  │   [ Nächste Runde ]      │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

---

## 6. Technische Umsetzung

### Ordner

```
wortbombe/                      → https://tbnsuperkid.github.io/wortbombe/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  js/inhalte/silben.js, anfang-ende.js, kategorien.js
  js/bomb.js                    Zündzeit, Tick-Plan (Tempo-Kurve), Ton, Knall, Animation
  js/engine.js                  Spieler, Runden, Strafpunkte, Ausscheiden, Aufgabe ziehen (ohne Wiederholung)
  js/app.js
tests/wortbombe.test.js
```

- **Kein Netzwerk** – reines Ein-Gerät-Spiel, offline-fähig über `sw.js`.
- Der Tick-Plan wird beim Zünden **vorab** berechnet (Liste von Zeitpunkten), dann mit `AudioContext`-Zeit genau
  abgespielt – `setTimeout` allein ruckelt.

### Tests

- Zündzeit im Bereich, Beschleunigungs-Start im Bereich, Tick-Abstände werden nie größer nach Beschleunigungs-Start
- Strafpunkte, Ausscheiden, letzte Person gewinnt, „ohne Ausscheiden“-Wertung
- Aufgaben: keine Wiederholung pro Abend, Stufen-Filter, Ab-18-Filter

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                | Ergebnis        |
| ------ | --------------------------------------------------------------------- | --------------- |
| **1**  | `bomb.js` (Ton, Zufall, Knall) + Silben-Modus + Strafpunkte, Karte auf der Startseite | Spielbar 💣 |
| **2**  | weitere Modi, Kategorien, Stufen per Skript, Trinkregeln                | Fertig 🎉        |

## 8. Offene Entscheidungen

1. Auf der Startseite bei den **normalen** Spielen oder bei den **Trinkspielen**?
2. Ausscheiden nach 3 Strafpunkten oder einfach zählen?
