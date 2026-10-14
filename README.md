# 🎲 MiniGames

Unsere Spieleseite für Spieleabende mit Freunden: **https://tbnsuperkid.github.io/**

Beim Öffnen der Seite erscheint die Spieleauswahl. Jedes Spiel liegt in einem eigenen Ordner.

| Spiel                    | Ordner      | Adresse                                   |
| ------------------------ | ----------- | ----------------------------------------- |
| Activity                 | `activity/` | https://tbnsuperkid.github.io/activity/   |

### Neues Spiel hinzufügen

1. Einen neuen Ordner anlegen, z. B. `quiz/`, mit einer eigenen `index.html`
   (gemeinsame Bibliotheken & Schriften liegen in `vendor/`, erreichbar über `../vendor/…`)
2. In der `index.html` im Hauptordner eine weitere Spielkarte (`<a class="game" …>`) einfügen
3. Für den Node-Server den Ordner in `server/server.js` bei `PUBLIC_DIRS` eintragen

---

## Activity – Erklären, Zeichnen, Pantomime

Das Partyspiel **Activity** als Website – im **Offline-Modus** auf einem Gerät, das herumgereicht wird,
oder im **Online-Modus**, bei dem jede Person auf dem eigenen Handy mitspielt.

## Features

- **Spielbrett** als Rundkurs mit zufällig verteilten Feldern der 3 Kategorien
  💬 Erklären · ✏️ Zeichnen · 🎭 Pantomime (Startfeld: Kategorie frei wählbar)
- **3 animierte Kartenstapel**: Leicht (3 Punkte), Mittel (4 Punkte), Schwer (5 Punkte) –
  die Karte fliegt vom Stapel in die Mitte und dreht sich um
- **999 Begriffe**: 333 pro Kategorie (je 111 leicht / mittel / schwer)
- **Erklären-Karten** haben immer **3 verbotene Wörter**
- **18+-Modus** (optional): 200 zusätzliche Begriffe, gleichmäßig verteilt (67 / 67 / 66)
- **Bis zu 4 Teams** in Rot, Blau, Grün und Gelb – mit Teamnamen und Spielernamen
- **Reihum erklären**: In jedem Team ist bei jedem Zug eine andere Person dran
- Timer (30–120 s) mit Ticken in den letzten Sekunden, Pause, Sounds, Konfetti, Siegerehrung
- **Zeichenfläche** auf dem Bildschirm (online live für alle sichtbar)
- **Handy als Kartenhand** im Offline-Spiel: Laptop/Tablet zeigt das Spielbrett, per QR-Code wird ein Handy
  verbunden, das die Kartenstapel, die Person am Zug und die Kategorie zeigt
- **Online**: Raum-Code, Einladungslink und QR-Code, Lobby mit Teamwahl, Karte nur für die Person sichtbar,
  die dran ist, Tipps können eingetippt werden (werden automatisch erkannt), Wiederverbinden nach Neuladen
- Spielstand wird automatisch gespeichert, funktioniert als App (PWA) auch ohne Internet
- Für Handy, Tablet und Desktop optimiert

## Spielen

### Offline (ein Gerät)

1. **Offline spielen** → Teams aktivieren, Team- und Spielernamen eintragen, Einstellungen wählen
2. Das Team am Zug wählt einen Kartenstapel (die Kategorie steht auf dem Feld der eigenen Spielfigur)
3. Gerät an die Person geben, die dran ist → **Karte aufdecken** → **Zeit starten**
4. Erraten? **✓ Erraten!** – die Figur zieht so viele Felder vor, wie die Karte Punkte bringt

### Offline mit Laptop als Spielbrett + Handy als Kartenhand

1. Am Laptop (oder Tablet/Fernseher) ein Offline-Spiel anlegen und **📱 Handy als Kartenhand** einschalten
   (oder später oben auf **📱 Handy verbinden** tippen)
2. Den angezeigten **QR-Code** mit dem Handy scannen
3. Das Handy zeigt, **wer dran ist** und **welche Kategorie** gilt, dazu die **3 Kartenstapel**.
   Das Handy wird immer an die Person weitergegeben, die dran ist – nur sie sieht die Karte
4. Der Laptop zeigt Spielbrett, Timer und nur die Rückseite der Karte. Beim Zeichnen kann auf dem Handy
   gezeichnet werden, das Bild erscheint live auf dem Laptop
5. Nach dem Zug auf dem Handy **Weiter** tippen und es der nächsten Person geben

Das Handy braucht dafür eine Internetverbindung (gleicher Verbindungsweg wie der Online-Modus, siehe unten).
Verliert es kurz die Verbindung oder wird eine Seite neu geladen, verbinden sich beide Geräte automatisch wieder.

### Online (jeder mit eigenem Gerät)

1. Eine Person tippt auf **Online spielen → Raum erstellen**
2. Die anderen öffnen den Einladungslink / QR-Code oder geben den **Raum-Code** ein
3. In der Lobby wählt jede Person ihr Team, der Host startet das Spiel
4. Die Karte sieht nur, wer dran ist. Beim Zeichnen sehen alle die Zeichnung live,
   das eigene Team kann Tipps eintippen. (Für Pantomime/Erklären aus der Ferne einfach zusätzlich einen Videocall nutzen.)

## Website bereitstellen

Die Seite besteht nur aus statischen Dateien (kein Build-Schritt nötig).

### Variante A: GitHub Pages (kostenlos, ohne eigenen Server)

1. Im Repository auf GitHub: **Settings → Pages**
2. Bei *Source* „Deploy from a branch“ wählen, Branch **main** und Ordner **/ (root)** → *Save*
3. Nach ca. einer Minute ist die Seite unter `https://tbnsuperkid.github.io/` erreichbar,
   Activity unter `https://tbnsuperkid.github.io/activity/`

Der Online-Modus nutzt dabei direkte Verbindungen zwischen den Geräten (WebRTC über
[PeerJS](https://peerjs.com/)). Das klappt in den allermeisten Netzwerken; in sehr strikten
Firmen- oder Mobilfunknetzen kann eine Verbindung scheitern – dann hilft Variante B.

### Variante B: Eigener Node-Server (zuverlässigster Online-Modus)

```bash
npm install
npm start          # http://localhost:3000  (Port über PORT=… änderbar), Activity unter /activity/
```

Der Server liefert die Website aus und vermittelt den Online-Modus per WebSocket. Er lässt sich
auf jedem Node-Hoster (z. B. Render, Railway, Fly.io) betreiben: Start-Befehl `npm start`.

### Nur offline spielen

`activity/index.html` einfach im Browser öffnen – fertig.

## Begriffe anpassen

Die Begriffe liegen in `activity/js/words/`:

| Datei          | Inhalt                                          | Format pro Zeile                       |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `erklaeren.js` | 333 Begriffe (111 je Schwierigkeit)             | `Begriff\|Tabu 1\|Tabu 2\|Tabu 3`      |
| `zeichnen.js`  | 333 Begriffe                                    | `Begriff`                              |
| `pantomime.js` | 333 Begriffe                                    | `Begriff`                              |
| `adult.js`     | 200 Begriffe ab 18 (67 / 67 / 66), in alle Stapel gemischt | `Begriff\|Tabu 1\|Tabu 2\|Tabu 3` |

`npm test` prüft Anzahl, Tabuwörter und doppelte Begriffe sowie die Spiellogik.

## Projektstruktur

```
index.html                     Spieleauswahl (Startseite)
hub.css                        Design der Spieleauswahl
sw.js                          Service Worker der Startseite
vendor/                        gemeinsame Bibliotheken & Schriften (siehe vendor/LICENSES.md)
server/server.js               optionaler Node-Server (statische Dateien + WebSocket-Relay)
tests/                         Tests (npm test)

activity/index.html            Activity: Einstieg
activity/css/style.css         Design
activity/js/app.js             Oberfläche (Bildschirme, Brett, Stapel, Karten, Timer)
activity/js/engine.js          Spielregeln & Spielzustand
activity/js/deck.js            Kartenstapel (Ziehen ohne Wiederholungen)
activity/js/controllers.js     Offline (+ Handy-Kartenhand) / Online-Host / Online-Mitspieler
activity/js/net.js             Netzwerk: WebSocket-Relay oder PeerJS
activity/js/sketch.js          Zeichenfläche
activity/js/fx.js              Sounds & Konfetti
activity/js/words/             Begriffslisten
activity/sw.js                 Service Worker (Offline-Fähigkeit)
```

„Activity“ ist eine Marke von Piatnik. Dieses Projekt ist ein privates Fan-Projekt ohne Verbindung zum Verlag.
