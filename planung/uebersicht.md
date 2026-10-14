# 🗺️ Übersicht – Planung aller Spiele

Stand der Ideen aus [`Ideen.md`](../Ideen.md):

| Spiel                  | Plan                                              | Stand              |
| ---------------------- | ------------------------------------------------- | ------------------ |
| 🎨 Activity             | –                                                 | ✅ fertig           |
| 🧠 2 Dumme, 1 Gedanke   | [2-dumme-ein-gedanke.md](2-dumme-ein-gedanke.md)  | ✅ fertig           |
| 🧩 Jeopardy             | [jeopardy.md](jeopardy.md)                        | 📝 geplant          |
| 📏 Schätzfragen         | [schaetzfragen.md](schaetzfragen.md)              | 📝 geplant          |
| 🕵️ Imposter             | [imposter.md](imposter.md)                        | 📝 geplant          |
| 🍻 Piccolo              | [piccolo.md](piccolo.md)                          | 📝 geplant          |
| 🔐 Codenames            | [codenames.md](codenames.md)                      | 📝 geplant          |
| 🏇 Pferderennen         | [pferderennen.md](pferderennen.md)                | 📝 geplant          |

## Die Spiele auf einen Blick

| Spiel          | Personen        | Teams?          | Geräte                                  | Kern-Aufwand                       |
| -------------- | --------------- | --------------- | --------------------------------------- | ---------------------------------- |
| Jeopardy       | 2–16            | 1–4 Teams       | Laptop-Wand + Handys als Buzzer         | Fairer Buzzer, Editor, viele Fragen |
| Schätzfragen   | 2–12            | einzeln / Teams | Laptop + Handys                          | Geprüfte Fragen, Zahlenstrahl       |
| Imposter       | 3–15            | einzeln         | **ein Gerät** oder Handys                | Rollen geheim halten, Abstimmung    |
| Piccolo        | 2–20            | einzeln         | **ein Gerät**, Handys optional           | Kartentexte schreiben               |
| Codenames      | 4–12            | 2 Teams         | Laptop + Chef-Handys (QR, offline)       | Schlüssel per Link, Hinweis-Prüfung |
| Pferderennen   | 2–20            | einzeln         | **ein Gerät**, Handys optional           | Rennlogik, Animation, Verteilen     |

## Empfohlene Reihenfolge

| #  | Spiel           | Warum jetzt?                                                                                  |
| -- | --------------- | --------------------------------------------------------------------------------------------- |
| 1  | **Imposter**    | Klein, sofort spielbar auf einem Gerät, sehr beliebt. Etappe 1 braucht kein Netzwerk.         |
| 2  | **Piccolo**     | Technisch einfach (ein Gerät), Aufwand steckt fast nur in den Karten.                         |
| 3  | **Pferderennen**| Kleine Rennlogik, keine Inhalte nötig, läuft auf einem Gerät. Passt als zweites Trinkspiel.    |
| 4  | **Codenames**   | Etappe 1 kommt dank Schlüssel-QR ohne Raum aus; Handy-Modus nutzt dann die gemeinsamen Bausteine. |
| 5  | **Schätzfragen**| Gleiches Muster wie 2 Dumme (Laptop + Handys). Die Fragen müssen sorgfältig geprüft werden.    |
| 6  | **Jeopardy**    | Das größte Projekt: Buzzer übers Netz, Editor für eigene Wände, mehrere Hundert Fragen.        |

## Gemeinsame Bausteine (Schritt 0 vor dem nächsten Handy-Spiel)

`shared/` hat schon Netzwerk (`net.js`), Sounds & Konfetti (`fx.js`) und `config.js`. Mehrere neue Spiele
brauchen dieselben Teile, die heute in `zwei-dumme/` bzw. `activity/` stecken:

| Neu in `shared/`     | Woher                                  | Gebraucht von                         |
| -------------------- | -------------------------------------- | ------------------------------------- |
| `match.js`           | `zwei-dumme/js/match.js`               | Imposter (Wort raten), Codenames (Hinweis prüfen), Jeopardy (Finale) |
| `deck.js`            | `zwei-dumme/js/deck.js` / `activity/js/deck.js` | alle (Ziehen ohne Wiederholung über Spiele hinweg) |
| `room.js`            | `StageController` / `ClientController` aus `zwei-dumme/js/controllers.js`: Raum, QR, Ping, Wiederverbinden, gefilterte Ansicht, `Store`, Spieler-ID | Jeopardy, Schätzfragen, Imposter, Codenames, Pferderennen, Piccolo (Abstimmungen) |
| `ui.css` / `ui.js`   | Lobby mit Teamwahl, Countdown, Timer-Balken, Punktetafel, **Siegerehrung mit Podest** | alle mit Punkten |
| `drinks.js`          | neu: Trinkregeln-Schalter, Schluck/Strafpunkt-Texte, Einblendung | Piccolo, Pferderennen, Codenames, später optional in allen |

So schrumpft jedes neue Spiel auf **Regeln (`engine.js`) + Inhalte + Oberfläche**. Activity und 2 Dumme
werden dabei auf die gemeinsamen Teile umgestellt und müssen unverändert weiterlaufen (`npm test`).

Für jedes neue Spiel außerdem (siehe README „Neues Spiel hinzufügen“):
- Karte in der `index.html` der Startseite
- Ordner bei `PUBLIC_DIRS` in `server/server.js`
- eigener Test in `tests/` und in `package.json` → `npm test`
- eigener PeerJS-Präfix (`GameNet.create('imposter-v1-')`) und `{ game: '…' }` beim Beitreten

## Idee für alle: 🍻 Trinkregeln-Schalter

Da „Trinkspiele“ eine eigene Kategorie in den Ideen ist: Jedes Spiel könnte einen optionalen Schalter
**„Trinkregeln“** bekommen (Standard aus, mit Alkoholfrei-Variante), z. B.

| Spiel         | Beispiel-Regel                                          |
| ------------- | ------------------------------------------------------- |
| Schätzfragen  | Wer am weitesten daneben liegt, trinkt 1                 |
| Imposter      | Erwischter Imposter trinkt 2, unentdeckter verteilt 3    |
| 2 Dumme       | Kette nicht geschafft → ganzes Team trinkt 1             |
| Jeopardy      | Falsche Antwort → 1 Schluck pro 200 Punkte Feldwert      |

Auf der Startseite könnten Trinkspiele (Piccolo, Pferderennen, Codenames mit Trinkregeln) in einem eigenen Abschnitt
**„🍻 Trinkspiele (ab 18)“** stehen.

## Offene Grundsatzfragen

1. **Namen:** Jeopardy, Codenames und Piccolo sind Marken. Wie bei Activity mit Fan-Projekt-Hinweis – oder
   eigene Namen (*Quizwand*, *Decknamen*, *Prost!*)? Gilt dann für alle drei gleich.
2. **Reihenfolge** wie oben vorgeschlagen?
3. **Gemeinsame Bausteine** zuerst auslagern (sauberer, etwas Vorarbeit) oder jedes Spiel erst mal für sich
   bauen und später zusammenführen? *Vorschlag:* auslagern, sobald das erste neue Handy-Spiel ansteht
   (Imposter Etappe 2).
