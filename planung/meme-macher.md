# 🖼️ Meme-Macher – Planung

Angelehnt an **Make It Meme** (makeitmeme.com) und das Kartenspiel *What Do You Meme?*: Alle bekommen **dasselbe
Bild** aufs Handy und schreiben einen **Meme-Text** dazu – oben, unten, in Sprechblasen. Dann werden alle Memes auf
dem Laptop gezeigt, und alle stimmen ab, welches am lustigsten ist.

Der **Laptop** ist die **Bühne** (Vorführung, Abstimmung), die Memes entstehen auf den **Handys**.

> Name: Arbeitstitel **Meme-Macher**, Ordner `meme-macher/` (Alternativen: *Memefabrik*, *Bildunterschrift*).

## Überblick

- **3–12 Personen**
- **5 Runden** (einstellbar), pro Runde ein Bild, am Ende Siegerehrung + **Galerie zum Speichern**
- Gerät: **Laptop + Handys** (Pflicht)
- Aufwand: **Bilder** (rechtlich sauber, siehe unten) + **Meme-Editor auf dem Handy** + Abstimmung

---

## 1. Ablauf einer Runde

| Phase            | Was passiert                                                                    | Zeit    |
| ---------------- | ------------------------------------------------------------------------------- | ------- |
| **1. Bild**       | Alle sehen dasselbe Bild (Modus „Gleiches Bild“) oder jede/r zieht eines aus 3 (Modus „Freie Wahl“) | – |
| **2. Texten**     | Text oben/unten oder in vorgegebene Felder tippen, Vorschau live                | 90 s    |
| **3. Zeigen**     | Bühne zeigt alle Memes **anonym** nacheinander (5 s) und dann alle im Raster     | –       |
| **4. Abstimmen**  | Jede/r tippt das beste Meme an (nicht das eigene). Option: **2 Stimmen**          | 20 s    |
| **5. Auflösung**  | Wer hat was gemacht, Stimmen als Avatare, Punkte                                | –       |

### Punkte

| Wofür                          | Punkte |
| ------------------------------ | ------ |
| Pro Stimme                     | 100    |
| Meiste Stimmen der Runde        | +100   |
| **Alle** Stimmen der Runde      | +200   |

### Sonderrunden (zufällig, ab Runde 3)

- **🔄 Tauschrunde:** Man textet das Bild, das die **Nachbarin** ausgewählt hat
- **⚡ Blitz:** nur 30 s
- **🎯 Thema:** Vorgabe *„Montagmorgen“*, *„Gruppenchat“*, *„Wenn die Oma fragt, was du beruflich machst“*

---

## 2. Die Bilder 🖼️ (Kernstück)

Bekannte Meme-Vorlagen (*Distracted Boyfriend*, *Drake*, *This is fine* …) sind **Fotos oder Zeichnungen mit
Urheberrecht** – wir legen sie **nicht** auf unsere öffentliche Seite. Stattdessen:

| Quelle                          | Wie                                                                     | Menge     |
| ------------------------------- | ----------------------------------------------------------------------- | --------- |
| 🆓 **Freie Fotos**               | Bilder mit **CC0/Public Domain** (z. B. Wikimedia Commons, Openverse), mit Quelle in `vendor/LICENSES.md` bzw. einer eigenen Liste | 150 |
| 📸 **Eigene Bilder der Runde**   | Vor dem Spiel lädt jede/r **2–3 Fotos** vom eigenen Handy hoch (Partyfotos, Haustiere, Urlaub) – die besten Memes entstehen mit Bildern, die alle kennen | beliebig |
| 🎨 **Eigene Zeichnungen**        | Variante: Runde 0 = jede/r zeichnet ein Bild (Zeichenfläche aus `shared/sketch.js`), das dann alle betexten | –   |
| 😀 **Emoji-Szenen**              | Aus großen Emojis zusammengesetzte Szenen (z. B. 🐶☕🔥) – frei verfügbar, lustig, schnell | 60 |

**Freie Fotos:** Wir suchen gezielt **„memige“** Motive: schauende Tiere, absurde Alltagsszenen, Gesichter von
Statuen, leere Räume. Für jedes Bild: Datei (WebP, max. 1200 px, ~100 KB), Lizenz, Urheber, Link. Test prüft,
dass jede Datei einen Lizenz-Eintrag hat. **Keine** Fotos erkennbarer Privatpersonen.

**Eigene Bilder:**
- Upload auf dem Handy (`<input type="file" accept="image/*">`), wird **auf dem Handy verkleinert** (max. 1000 px,
  JPEG/WebP ~80 %) und dann über die bestehende Verbindung zum Laptop geschickt (PeerJS-Datenkanal, in Stücken).
- Bilder bleiben **nur für dieses Spiel im Speicher**, werden nirgendwo hochgeladen und nicht gespeichert.
- Hinweis in der Lobby: *„Nur Fotos hochladen, mit denen alle Abgebildeten einverstanden sind.“*

---

## 3. Der Meme-Editor auf dem Handy ✏️

- **Layouts:** *Oben/Unten* (klassisch), *Nur unten*, *Zwei Felder* (z. B. Vergleich), *Sprechblase* (frei
  verschiebbar), *Beschriftungen* (bis 3 frei platzierbare Etiketten – wie bei *Distracted Boyfriend*)
- **Schrift:** fett, weiß mit schwarzem Rand, Großbuchstaben (Meme-Stil) – freie Schrift wie **Anton** (SIL OFL) in
  `vendor/fonts/`, Größe passt sich automatisch an
- **Live-Vorschau** als Canvas, Text automatisch umbrechen
- **Ideen-Knopf 💡**, falls einem nichts einfällt (zeigt ein Thema, keinen fertigen Text)
- Abgegeben wird **nur der Text + Positionen**, nicht das gerenderte Bild – die Bühne rendert selbst (kleine
  Nachrichten, gleiche Darstellung überall)

---

## 4. Einstellungen

| Option              | Werte                                      | Standard          |
| ------------------- | ------------------------------------------ | ----------------- |
| Runden              | 3 / 5 / 8                                  | 5                 |
| Bilder              | Freie Fotos / Eigene / Gemischt / Emoji     | Gemischt (wenn eigene da sind) |
| Bild pro Runde      | Gleiches Bild für alle / Freie Wahl aus 3   | Gleiches Bild     |
| Zeit zum Texten     | 60 / 90 / 120 s                            | 90 s              |
| Stimmen pro Person  | 1 / 2                                      | 1                 |
| Sonderrunden        | an / aus                                   | an                |
| Familienrunde       | Hinweis + Spielleitung kann Memes ausblenden | aus             |
| 🍻 Trinkregeln       | 0 Stimmen → 1 Schluck, alle Stimmen → 3 verteilen | aus         |

---

## 5. Bildschirme

### Laptop

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🖼️ Meme-Macher · Runde 2/5 · Abstimmen                         ⏱ 14 s     │
├──────────────────────────────────────────────────────────────────────────┤
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│   │ WENN DER CHEF│  │  ICH NACH    │  │ MEIN WLAN    │  │ ICH, WENN    │ │
│   │   (Foto)     │  │   (Foto)     │  │   (Foto)     │  │   (Foto)     │ │
│   │ „KURZ“ SAGT  │  │ 1 BIER       │  │ UM 3 UHR     │  │ JEMAND ANRUFT│ │
│   └──────── A ───┘  └──────── B ───┘  └──────── C ───┘  └──────── D ───┘ │
│                         abgestimmt: ●●●○○                                │
└──────────────────────────────────────────────────────────────────────────┘
```

### Handy

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ 🖼️ Runde 2 · ⏱ 0:58       │  │ 🖼️ Welches ist am besten? │
│ ┌─────────────────────┐ │  │                         │
│ │  WENN DER CHEF      │ │  │ [ A ]  [ B ]             │
│ │     (Foto)          │ │  │ [ C ]  [ D ] (deins 🔒)   │
│ │  „KURZ“ SAGT        │ │  │                         │
│ └─────────────────────┘ │  │ (Vorschaubilder)        │
│ Oben  [ Wenn der Chef ] │  │                         │
│ Unten [ „kurz“ sagt   ] │  │                         │
│ [ Layout ▾ ] [ 💡 ] [✓] │  │                         │
└─────────────────────────┘  └─────────────────────────┘
```

**Ende:** **Galerie** aller Memes, Sieger-Meme groß, **„Alle speichern“** (ZIP oder einzelne PNGs über `canvas.toBlob`),
Auszeichnungen: „😂 Meme-Lord“ (meiste Stimmen insgesamt), „💯 Volltreffer“ (Meme mit allen Stimmen), „🦗 Tumbleweed“.

---

## 6. Technische Umsetzung

### Ordner

```
meme-macher/                    → https://tbnsuperkid.github.io/meme-macher/
  index.html, manifest.webmanifest, favicon.svg, sw.js
  css/style.css
  img/                          freie Bilder (WebP) + bilder.js (Liste mit Lizenz, Urheber, Link)
  js/layouts.js                 Layouts (Felder, Positionen)
  js/render.js                  Meme zeichnen (Canvas): Bild, Text mit Rand, Umbruch, Größe anpassen
  js/upload.js                  Eigene Bilder: verkleinern, in Stücken senden, zusammensetzen
  js/engine.js                  Runden, Bilder ziehen, Abgaben, Abstimmung, Punkte, Sonderrunden, Ansichten
  js/controllers.js             GameRoom.create({ game: 'meme-macher', net: 'mememacher-v1-', storage: 'mememacher', engine })
  js/app.js
tests/meme-macher.test.js
```

### Architektur

- Handys schicken `join`, `upload` (Bild in Stücken), `pick` (Freie Wahl), `meme` ({ layout, texts, positions }), `vote`, `hide`, `next`.
- **Große Daten (Bilder)** laufen getrennt vom Spielzustand: Eigene Bilder schickt der Laptop **einmal pro Runde**
  an alle Handys (als eigene Nachricht), nicht in jedem `view`. `shared/room.js` muss dafür evtl. eine Nachricht
  `blob` bekommen.
- **Anonym** bis zur Auflösung, Reihenfolge der Memes gemischt.
- **Spielzustand** (vereinfacht):
  ```js
  {
    settings: { rounds: 5, images: 'mixed', perRound: 'same', time: 90, votes: 1, specials: true, drinks: false },
    players: [{ id, name, score, connected }],
    pool: [{ id: 'free:hund-sofa', src: 'img/hund-sofa.webp' }, { id: 'own:p2:1', owner: 'p2' }],
    round: 2, image: 'free:hund-sofa', special: null,
    memes: { p1: { layout: 'top-bottom', texts: ['Wenn der Chef', '„kurz“ sagt'] }, … },
    order: ['p3', 'p1', …], votes: { p1: 'p3', … },
    phase: 'lobby' | 'upload' | 'write' | 'show' | 'vote' | 'result' | 'end'
  }
  ```

### Tests

- Freie Bilder: jede Datei hat Lizenz + Urheber + Link, max. Dateigröße
- Abstimmung: nicht für sich selbst, 2-Stimmen-Modus, Punkte, „alle Stimmen“-Bonus
- Upload: Bild in Stücken → gleiches Bild zusammengesetzt, zu große Bilder werden verkleinert
- Render: Text-Umbruch, Schriftgröße passt in das Feld, leere Felder
- **Gefilterte Ansicht:** Autoren vor `result` unbekannt

---

## 7. Umsetzung in Etappen

| Etappe | Inhalt                                                                    | Ergebnis          |
| ------ | ------------------------------------------------------------------------- | ----------------- |
| **1**  | 50 freie Bilder + Lizenzen, `render.js` (Oben/Unten), Editor auf dem Handy  | Memes entstehen 🖼️ |
| **2**  | Engine + Handys: Runden, Zeigen, Abstimmen, Punkte, Karte auf der Startseite | Spielbar 😂        |
| **3**  | **Eigene Bilder** hochladen, weitere Layouts, Galerie speichern             | Das volle Erlebnis 📸 |
| **4**  | 150 Bilder, Sonderrunden, Emoji-Szenen, Zeichnen-Runde, Trinkregeln         | Fertig 🎉          |

## 8. Offene Entscheidungen

1. Name: **Meme-Macher** oder etwas anderes?
2. Eigene Bilder von Anfang an (macht das Spiel aus, ist aber technisch aufwendiger)?
3. Galerie zum Speichern – ja?
