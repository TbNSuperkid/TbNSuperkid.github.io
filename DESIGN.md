# 🎨 Design-System

Wie die Spiele und die Spieleauswahl aussehen, woher Farben, Schrift und Icons kommen und wie ein Spiel auf den
gemeinsamen Look umgestellt wird.

**Stand 24.11.2026:** Umgestellt sind die **Spieleauswahl** (`index.html`) und die Kategorie **Quiz & Schätzen**:
Pi mal Daumen (Pilot), Who knows more? und Echt jetzt?. Die übrigen 18 Spiele haben noch ihr eigenes, älteres Design
und werden nach und nach umgestellt (siehe [Offen](#offen)).

Die freigegebenen Entwürfe liegen als Mockup-Canvas unter https://claude.ai/artifact/AtuX9Vt6vE1fdeKABHVZRY
(privat – nur für Tobias sichtbar, solange er ihn nicht teilt).

---

## Grundsätze

- **Ruhig und klar statt bunt:** fast schwarzer Grund, Flächen nur mit feinen Linien abgesetzt – keine Farbverläufe,
  kein Glühen, keine Schatten (Ausnahme: Dialoge).
- **Eine Akzentfarbe pro Spiel, sparsam eingesetzt:** Hauptbutton, Fortschritt, Spiel-Icon. Sonst nirgends.
- **Eine Schrift:** Inter in drei Stärken (400, 500, 600). Fredoka nur noch für das MiniGames-Logo.
- **Icons statt Emojis:** Linien-Icons sehen auf Windows, iPhone und Android gleich aus. Emojis nur noch als
  Spielinhalt (z. B. in Fragen), nie in Buttons, Überschriften oder Tags.
- **Bühne lesbar aus 3 m:** Auf Laptop/TV wächst die Schrift mit der Bildschirmbreite.
- **Handy zuerst bedienbar:** große Ziele (mind. 40–44 px), alles ohne seitliches Scrollen.

---

## Dateien

| Datei                      | Inhalt                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `shared/ui.css`            | Schrift, Farben, Grundstil und alle gemeinsamen Bausteine der Spiele                     |
| `shared/icons.js`          | Icon-Set (91 Icons) als Inline-SVG: `GameIcons.svg('check')`                             |
| `shared/ui.js`             | HTML-Bausteine der Spiele (Lobby, Menü, Dialoge, Startseite …): `GameUI.seg(…)`          |
| `vendor/fonts/inter.woff2` | Inter (variabel, Latin-Subset, SIL Open Font License) – lokal, damit alles offline läuft  |
| `hub.css`, `hub.js`        | Spieleauswahl: Layout, Karten, Suche und Filter                                          |
| `<spiel>/css/style.css`    | nur noch, was es in diesem Spiel gibt (+ `--accent`)                                     |

Ladereihenfolge in einem Spiel:

```html
<link rel="stylesheet" href="../shared/ui.css" />
<link rel="stylesheet" href="css/style.css" />
…
<script src="../shared/icons.js"></script>   <!-- vor js/app.js -->
<script src="../shared/ui.js"></script>      <!-- nach icons.js, vor js/app.js -->
```

### Bausteine in `shared/ui.js`

Reine Funktionen, die HTML liefern (keine Spiellogik, kein Zustand). Die Klicks laufen weiter über `data-act` und
werden vom Spiel behandelt. In `app.js`:

```js
const UI = window.GameUI;
const { esc, plural, session } = UI;
const tc = UI.teamStyle;
```

| Bereich      | Funktionen                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------- |
| Text         | `esc` `plural` `teamStyle` `session` `connectError(code)`                                          |
| Kopf         | `logo(name, icon, small)` `hubBack()` `screenHead(titel, { back, backLabel, right })` `rulesButton()` `topbar(logo, info, muted)` |
| Startseite   | `modeCard({ act, icon, title, text, go })` `resume({ act, title, sub, discard, discardLabel })`    |
| Verbinden    | `joinScreen({ logo, name, code, error })` `connecting(status)` `statusBanner(status)` `roomBox(room, big)` |
| Einstellungen| `seg(key, werte, wert, fmt, scope)` `toggle(an, { key, scope, act })` `setting(titel, text, control)` `settingsSummary(teile)` |
| Bühne        | `timer(t, { tick, clock, cls })` `chip(m, { dot, style })` `podiumStep({ place, index, name, points })` `award(a, iconMap)` |
| Dialoge      | `modal(body, { wide })` `confirmBody(c)` `modalDone()` `menu(items)` `menuBasics(muted)` `menuItem(act, icon, label, { attrs, small, danger })` |

Alles, was Namen oder Texte von Spielern bekommt, wird maskiert. Ausnahme: `text` bei `modeCard`, `sub` bei `resume`,
`right` bei `screenHead` und `info` bei `topbar` sind HTML (dort selbst `esc` benutzen). Tests: `tests/ui.test.js`.

---

## Farben

Alle Farben sind CSS-Variablen in `shared/ui.css` (`:root`).

| Variable                          | Wert                    | Wofür                                         |
| --------------------------------- | ----------------------- | --------------------------------------------- |
| `--bg`                            | `#0e0c16`               | Seitengrund                                   |
| `--surface`                       | `#16141f`               | Karten, Panels                                |
| `--surface-2`                     | `#1b1926`               | Hover                                         |
| `--surface-3`                     | `#24222e`               | Buttons, Chips, gewählte Segmente             |
| `--line` / `--line-strong`        | Weiß 8 % / 14 %         | Ränder                                        |
| `--text`                          | `#f4f2f8`               | Text                                          |
| `--muted`                         | `#a19db0`               | Nebentext                                     |
| `--subtle`                        | `#8a8699`               | Zusatzinfos (noch ausreichend Kontrast)       |
| `--ok` / `--ok-text`              | `#4fc08d` / `#86d9a3`   | richtig, fertig                               |
| `--bad` / `--bad-text`            | `#e5605f` / `#f5a3a3`   | Fehler, gefährliche Aktionen                  |
| `--warn`                          | `#f5b14c`               | Hinweise, Verbindungsprobleme                 |
| `--accent`                        | je Spiel                | Hauptbutton, Fortschritt, Spiel-Icon          |
| `--on-accent`                     | `#0e0c16`               | Text auf Akzentfarbe (dunkel, auch bei Gelb lesbar) |
| `--accent-tint`                   | Akzent 14 %             | Hintergrund hinter Akzent-Icons               |

Teamfarben kommen weiter aus der jeweiligen Engine (`--team` als Inline-Style) und sind vom Spiel-Akzent unabhängig.

**Alte Variablennamen** (`--panel`, `--panel-strong`, `--bg-2`, `--paper`, `--ink`, `--shadow`, `--mid`) zeigen in
`ui.css` auf die neuen Werte, damit nicht umgestellte Teile eines Spiels weiter funktionieren.

Akzentfarben der Spiele (auch in der Spieleauswahl als `--c` an jeder Karte):

| Spiel | Akzent | Spiel | Akzent | Spiel | Akzent |
| --- | --- | --- | --- | --- | --- |
| Hit story | `#f2788c` | Guess the word! | `#a895f0` | Skribbl | `#bc93f0` |
| Guess the song | `#8e93f0` | 2 Dumme, 1 Gedanke | `#f2995c` | Flüsterpost | `#5cb4e6` |
| Finish the lyrics | `#ee9cc4` | Nur einer | `#e6cf5c` | Pointe! | `#ee85b4` |
| Pi mal Daumen | `#f5b14c` | Wavelength | `#4fc6b0` | Stadt, Land, Fluss | `#ecb85c` |
| Who knows more? | `#6ea6f0` | Wortbombe | `#f2885c` | Geheimsache | `#ef7b7b` |
| Echt jetzt? | `#4fc6d9` | Schlecht erklärt | `#e6c25c` | Imposter | `#f2788c` |
| Farbgefühl | `#f2885c` | Prost! | `#ecb07a` | Pferderennen | `#5cc08d` |

---

## Schrift & Größen

- **Inter** für alles (`--font`), Stärken 400 / 500 / 600. Große Überschriften mit leicht engerem Abstand
  (`letter-spacing: -0.02em`), Zahlen mit `font-variant-numeric: tabular-nums`.
- **Radien:** `--radius-s` 8 px (kleine Buttons, Chips) · `--radius` 10 px (Buttons, Eingaben) ·
  `--radius-l` 14 px (Karten, Panels) · `--radius-xl` 16 px (Dialoge, große Karten).
- **Höhen:** Buttons 36 / 44 / 52 px (`.btn-small` / `.btn` / `.btn-big`), Icon-Buttons 40 px.

### Bühne (Laptop / TV)

Auf Seiten mit `.stage`, `.setup` oder `.home` wächst die Grundschrift mit der Bildschirmbreite:

```css
html:has(.stage), html:has(.setup), html:has(.home) { font-size: clamp(16px, 1.15vw, 24px); }
```

Bei 1440 px sind das 16 px, bei 1920 px rund 22 px – alle `rem`-Größen wachsen mit. Deshalb **Größen auf der Bühne in
`rem` angeben, nicht in `px`** (Beispiel: der Zahlenstrahl in Pi mal Daumen – mit festen px-Höhen wurden die
Beschriftungen auf großen Bildschirmen abgeschnitten). Handys bleiben bei 16 px.

---

## Bausteine in `shared/ui.css`

Die Klassennamen sind die, die die Spiele schon vorher benutzt haben – ein umgestelltes Spiel muss sein HTML kaum ändern.

| Bereich             | Klassen                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Buttons             | `.btn` `.btn-primary` `.btn-ghost` `.btn-danger` `.btn-big` `.btn-small` `.btn-wide` `.btn-link` `.icon-btn` `.back-btn` `.hub-back` |
| Eingaben            | `.input` `.input-big` `.input-code` `.label` `.alert`                                          |
| Layout              | `.screen` `.screen-head` `.panel` `.hint` `.sticky-start`                                       |
| Startseite          | `.home` `.logo` `.logo-mark` `.logo-small` `.tagline` `.mode-cards` `.mode-card` `.mode-icon` `.mode-go` `.resume` |
| Spiel anlegen       | `.input-cards` `.input-card` `.team-grid` `.team-setup` `.ts-head` `.ts-add` `.settings` `.setting` `.setting-label` |
| Auswahl             | `.seg` `.seg-btn` (mehrere Werte) · `.switch` (an/aus) · `.chips` `.chip` `.chip-x`              |
| Bühne               | `.stage` `.topbar` `.pill` `.pill-hot` `.stage-main` `.center-stage` `.banner` `.timer` `.tstats` `.tstat` `.turn-banner` |
| Lobby               | `.lobby-grid` `.join-panel` `.qr` `.room-code` `.settings-summary` `.free`                     |
| Punktestand & Ende  | `.scoreboard` `.score` `.summary` `.over-title` `.podium` `.award`                              |
| Handy               | `.phone` `.phone-head` `.phone-main` `.team-pick` `.team-btn` `.waiting` `.submitted` `.look-up` |
| Dialoge & Hinweise  | `.overlay` `.modal` `.modal-wide` `.modal-sub` `.menu-item` `.rules` `.toast` `.countdown` `.flash` |

Ein paar Muster, die dazugehören:

- **Lobby:** Einstellungen stehen nur als eine Zeile da (`.settings-summary` mit „Ändern“), geändert wird im Dialog
  (`.modal-wide`). So steht beim Warten der QR-Code und wer schon da ist im Vordergrund.
- **Warten am Handy:** `.waiting` bekommt automatisch einen pulsierenden Punkt – kein ⏳ im Text.
- **Großer Zustand am Handy:** `<div class="look-up">${icon}<b>Titel</b><small>Text</small></div>` – das Icon wird
  automatisch zur Kachel.
- **Auf der Bühne steht die große Frage frei**, ohne Karte (in Pi mal Daumen: `.stage .q-card:not(.q-small)`).

---

## Icons

### In Spielen (JavaScript)

```js
const I = (name, opts) => window.GameIcons.svg(name, opts);
I('check');                         // dekorativ, aria-hidden
I('menu', { label: 'Menü' });        // eigenständig, mit role="img" und aria-label
`<button class="icon-btn" aria-label="Menü">${I('menu')}</button>`; // Icon-Button: Label am Button
```

Größe und Farbe kommen aus dem CSS (`.ico`: 1.15 em, `currentColor`). Unbekannte Namen liefern `''`.

Alle Namen: `node -e "console.log(require('./shared/icons.js').names.join(' '))"`

### Auf statischen Seiten (Spieleauswahl)

`index.html` funktioniert auch ohne JavaScript, deshalb stehen die Icons dort als **SVG-Sprite** am Anfang von `<body>`:

```html
<svg class="ico" aria-hidden="true"><use href="#i-users"/></svg>
```

Die `<symbol id="i-…">`-Einträge sind Kopien aus `shared/icons.js` (`GameIcons.symbol(name)` erzeugt sie).
Der Test `tests/hub.test.js` prüft, dass jedes benutzte Icon im Sprite steht **und** mit `shared/icons.js` übereinstimmt.

### Neues Icon

1. Pfade in `shared/icons.js` bei `PATHS` ergänzen (24 × 24, nur Linien; Vorlage: lucide.dev, ISC-Lizenz).
2. Auf der Spieleauswahl gebraucht? `node -e "console.log(require('./shared/icons.js').symbol('NAME'))"` und die Zeile
   ins Sprite in `index.html` kopieren.

**Spiel-Icons:** Die Motive der Spiele (Schallplatte, Zielscheibe, Glocke …) sind **vorläufig**. Eigene, aussagekräftige
Icons kommen später – dafür das jeweilige `<symbol>` im Sprite und den Eintrag in `shared/icons.js` ersetzen.

---

## Spieleauswahl (`index.html`)

- **Aufbau:** Kopfleiste (Logo, Suche) → „Was spielen wir heute?“ → Filter → Kategorien:
  Musik · Quiz & Schätzen · Wörter & Erklären · Zeichnen & Kreativ · Taktik & Bluff · Trinkspiele (immer am Ende).
  Bewusst **ohne** „Zuletzt gespielt“.
- **Karte** (ganze Karte ist der Link, Titel ist `<h3>`):

  ```html
  <a class="game" href="quiz/" style="--c: #f5b14c"
    data-features="one" data-min="2" data-max="12"
    aria-labelledby="t-quiz" aria-describedby="d-quiz g-quiz">
    <div class="game-head">
      <span class="game-icon"><svg class="ico" aria-hidden="true"><use href="#i-target"/></svg></span>
      <h3 id="t-quiz">Quiz</h3>
      <span class="badge">Neu</span>            <!-- optional -->
    </div>
    <p id="d-quiz">Ein Satz, worum es geht.</p>
    <ul class="tags" id="g-quiz">
      <li><svg class="ico" aria-hidden="true"><use href="#i-user"/></svg> 2–12 Personen</li>
      <li><svg class="ico" aria-hidden="true"><use href="#i-laptop"/></svg> Laptop, Handys optional</li>
    </ul>
  </a>
  ```

  Tag-Regeln (geprüft von `tests/hub.test.js`): zuerst `#i-user` (Personen) oder `#i-users` (Teams), dann genau eins von
  „Ein Gerät“ / „Ein Gerät oder Handys“ (`#i-phone`) oder „Laptop, Handys optional“ / „Laptop + Handys“ (`#i-laptop`),
  danach höchstens zwei Besonderheiten. Die Zahl in `<span class="cat-count">` muss zur Anzahl Karten passen.
- **Suche** (`hub.js`): durchsucht Titel und Beschreibung, ignoriert Groß/klein und Umlaute („flusterpost“ findet
  Flüsterpost), Esc leert. Wird nicht gespeichert.
- **Filter:** Personenzahl, „Ein Gerät reicht“, „Musik“, „Trinkspiele“. Kategorien ohne Treffer verschwinden, die Zahl
  neben der Überschrift passt sich an. Auswahl bleibt für die Sitzung (`sessionStorage`, Schlüssel `hub.filter`).
- **Handy (≤ 640 px):** Filter in zwei Spalten – alle sichtbar, ohne seitliches Scrollen (geprüft bei 390, 360 und
  320 px). Spiele als kompakte Liste, Beschreibung auf zwei Zeilen gekürzt (Screenreader lesen den ganzen Text).
- **Ohne JavaScript** sind Suche und Filter ausgeblendet, alle Spiele samt Icons sichtbar.

---

## Ein Spiel umstellen

So wurde Pi mal Daumen umgestellt – als Vorlage für die anderen Spiele:

1. **Einbinden:** `../shared/ui.css` vor `css/style.css`, `../shared/icons.js` und `../shared/ui.js` vor `js/app.js`;
   `theme-color` in `index.html` und `manifest.webmanifest` auf `#0e0c16`.
2. **`css/style.css` ausdünnen:** `@font-face`, `:root`-Farben und alle Bausteine aus der Tabelle oben löschen. Übrig
   bleiben `:root { --accent: … }` und nur das Spielspezifische (bei Pi mal Daumen: Fragekarte, Zahlenstrahl,
   Ergebnisse, Reihum-Modus, Joker, Kategorien – von 2263 auf 742 Zeilen). Verläufe, Schatten und Fredoka entfernen.
3. **Emojis in `js/app.js` ersetzen** durch `I('…')`. Achtung: `${I('…')}` funktioniert nur in Template-Strings
   (Backticks), nicht in `'…'` – danach `node --check js/app.js`. Emojis aus Engine oder Daten (z. B. Kategorien,
   Auszeichnungen) über eine kleine Tabelle auf Icons abbilden, statt die Engine zu ändern.
   **Gleich dabei die eigenen Bausteine durch `shared/ui.js` ersetzen:** `esc`, `session`, `plural`, `tc`, `seg`,
   `switchHtml` → `UI.toggle`, `timerHtml` → `UI.timer`, `roomBoxHtml`, `joinHtml`, `connectingHtml`,
   `phoneStatusBanner`, Startseiten-Karten, Menü, Dialog-Rahmen und Bestätigung löschen bzw. umstellen.
4. **Logo:** `UI.logo('Name', 'icon', small)`.
5. **Lobby:** Einstellungen als `.settings-summary`, Bearbeiten im Dialog.
6. **`sw.js`:** `../shared/ui.css`, `../shared/icons.js`, `../shared/ui.js`, `../vendor/fonts/inter.woff2` aufnehmen, nicht mehr
   gebrauchte Schriften entfernen, `CACHE`-Version erhöhen.
7. **Test** im Spiel-Test ergänzen – die gemeinsame Prüfung `tests/design-check.js` aufrufen
   (`checkDesign(assert, 'spiel', { files, cats })`): alle benutzten Icon-Namen existieren, keine Emojis mehr in der
   Oberfläche, `ui.css`/`icons.js`/`ui.js` eingebunden und im Service Worker, keine alten Schriften, `--accent` wie in der
   Spieleauswahl. Vorlage: letzter Test in `tests/who-knows-more.test.js` bzw. `tests/echt-jetzt.test.js`.
8. **Ansehen**, stumm (siehe CLAUDE.md): Startseite, Spiel anlegen, Lobby mit zwei Handys, Frage, Aufdecken, Menü –
   bei 1920 px (Bühne) und 390 px (Handy).

---

## Änderungen am 24.11.2026

**UI/UX-Audit** (stumme Screenshots aller 21 Startseiten, Lobby und Spiel mit zwei Handys). Wichtigste Befunde:
Bühne nutzte den Bildschirm nicht und war aus der Entfernung schlecht lesbar · Lobby wirkte wie ein Formular ·
Wartebildschirme am Handy leer · jedes Spiel mit eigenem CSS (zusammen ~48 000 Zeilen, Buttons, Chips, Lobby usw.
21-mal neu) · Emojis als Icons wirkten generisch · Spieleauswahl am Handy: eine Karte pro Bildschirm.
Daraus Mockups (zuerst bunt, dann auf Wunsch „cleaner, professioneller“) – freigegeben.

**Fehler behoben – Node-Server:** `server/server.js` lieferte `/hub.js` und `/icons/` nicht aus (404). Folge: lokal
keine Filter in der Spieleauswahl, und ihr Service Worker konnte sich nicht installieren (GitHub Pages war nicht
betroffen). Neuer Test: der Server liefert alles aus, was `sw.js` vorab speichert.

**Neu:** `shared/ui.css`, `shared/icons.js`, `vendor/fonts/inter.woff2` (in `vendor/LICENSES.md` eingetragen),
diese Datei.

**Pi mal Daumen (Pilot):**
- neues Aussehen über `shared/ui.css`, `style.css` nur noch spielspezifisch
- alle Emojis der Oberfläche durch Icons ersetzt (inkl. Kategorien und Auszeichnungen; die Emojis in `deck.js` und
  `engine.js` bleiben unverändert)
- Lobby: Einstellungen eingeklappt (Zusammenfassung + „Ändern“ → Dialog)
- Bühne: große Frage frei stehend, Schrift wächst mit dem Bildschirm
- behoben beim Testen: Zahlenstrahl-Beschriftungen auf großen Bildschirmen abgeschnitten (jetzt `rem`), „Weiter“
  lag über dem Punktestand
- Service Worker `pimaldaumen-v3`

**Spieleauswahl:**
- neu aufgebaut: Kategorien, Suche, Karten mit Spiel-Icon und Akzentfarbe, Linien-Icons in den Tags,
  ganze Karte klickbar, „Neu“-Markierung
- Handy: kompakte Liste, Filter in zwei Spalten ohne seitliches Scrollen; „Alle Personenzahlen“ heißt jetzt
  „Personen“, damit es auch auf 320 px passt
- Texte, Filterdaten und Tags unverändert übernommen (per Skript aus der alten Seite erzeugt)
- Service Worker `hub-v3`, lädt `shared/ui.css` und Inter statt Nunito
- Tests angepasst: Icons statt Emojis, Sprite = `shared/icons.js`, jede Karte in genau einer Kategorie

**Quiz & Schätzen fertig – Who knows more? und Echt jetzt?:**
- beide über `shared/ui.css`, `style.css` nur noch spielspezifisch (Who knows more? 2522 → 1108 Zeilen,
  Echt jetzt? 2549 → 950 Zeilen); Fredoka/Nunito, Verläufe, Glühen und schräge Karten entfernt
- alle Emojis der Oberfläche durch Icons ersetzt, auch im Wand-Editor; Kategorien und Auszeichnungen über Tabellen
  (`CAT_ICON`, `AWARD_ICON`), `engine.js` und Fragen unverändert
- Lobby: Einstellungen als eine Zeile + „Ändern“ (Dialog), bei Who knows more? samt Quizmaster
- Who knows more?: Wand als ruhige Kacheln (Hover in Akzentfarbe, gewähltes Feld gefüllt), „Buzzer frei“ = Rahmen der
  Fragekarte in Akzentfarbe, Handy-Buzzer flach in Teamfarbe mit Ring; Teamfarben bleiben wie in der Engine
- Echt jetzt?: Frage frei stehend auf der Bühne, Lücke in Akzentfarbe, Karten mit Grün (Wahrheit) / Rot (Lüge)
- neue Icons: save, trash, download, upload, copy, list, image, pointer, dice, grid, chart, scale, paw, wrench, fish
- behoben beim Ansehen: Logo „Who knows more?“ brach auf der Startseite um; lange Antworten auf Karten brachen mitten
  im Wort um (jetzt Silbentrennung)
- neuer gemeinsamer Test `tests/design-check.js`; Service Worker `wkm-v3`, `echtjetzt-v2`

**Gemeinsame Bausteine `shared/ui.js`:**
- Lobby, Menü, Dialoge, Startseite, Beitreten, Auswahlknöpfe, Schalter, Timer, Treppchen und Auszeichnungen gibt es
  jetzt einmal statt in jedem Spiel; Pi mal Daumen, Who knows more? und Echt jetzt? nutzen sie (zusammen gut 500 Zeilen
  weniger), Aussehen unverändert (im Browser durchgespielt)
- neue Tests `tests/ui.test.js`; `tests/design-check.js` verlangt `shared/ui.js`
- Service Worker `pimaldaumen-v4`, `wkm-v4`, `echtjetzt-v3`

**Tests:** „Handys sehen keine Antworten“ (Who knows more?) schlug in ~4 % der Läufe fehl, wenn eine Antwort zufällig
auch Kategoriename war – behoben. Pi mal Daumen nutzt jetzt ebenfalls `tests/design-check.js`.

---

## Offen

- **Die übrigen 18 Spiele umstellen** (Anleitung oben). Bis dahin sieht jedes Spiel beim Öffnen noch anders aus als
  die Spieleauswahl.
- **Eigene Spiel-Icons** statt der vorläufigen Motive.
