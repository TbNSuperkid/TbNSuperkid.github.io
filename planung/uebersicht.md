# 🗺️ Übersicht – Planung aller Spiele

Stand der Ideen aus [`Ideen.md`](../Ideen.md):

| Spiel                  | Plan                                              | Stand              |
| ---------------------- | ------------------------------------------------- | ------------------ |
| 🎨 Guess the word!      | –                                                 | ✅ fertig           |
| 🧠 2 Dumme, 1 Gedanke   | [2-dumme-ein-gedanke.md](2-dumme-ein-gedanke.md)  | ✅ fertig           |
| 🧩 Who knows more?      | [who-knows-more.md](who-knows-more.md)            | 📝 geplant          |
| 📏 Schätzfragen         | [schaetzfragen.md](schaetzfragen.md)              | 📝 geplant          |
| 🕵️ Imposter             | [imposter.md](imposter.md)                        | 📝 geplant          |
| 🍻 Prost!               | [prost.md](prost.md)                              | 📝 geplant          |
| 🔐 Geheimsache          | [geheimsache.md](geheimsache.md)                  | ✅ fertig |
| 🏇 Pferderennen         | [pferderennen.md](pferderennen.md)                | 📝 geplant          |

## Die Spiele auf einen Blick

| Spiel          | Personen        | Teams?          | Geräte                                  | Kern-Aufwand                       |
| -------------- | --------------- | --------------- | --------------------------------------- | ---------------------------------- |
| Who knows more?| 2–16            | 1–4 Teams       | Laptop-Wand + Handys als Buzzer         | Fairer Buzzer, Editor, viele Fragen |
| Schätzfragen   | 2–12            | einzeln / Teams | Laptop + Handys                          | Geprüfte Fragen, Zahlenstrahl       |
| Imposter       | 3–15            | einzeln         | **ein Gerät** oder Handys                | Rollen geheim halten, Abstimmung    |
| Prost!         | 2–20            | einzeln         | **ein Gerät**, Handys optional           | Kartentexte schreiben               |
| Geheimsache    | 4–12            | 2 Teams         | Laptop + Chef-Handys (QR, offline)       | Schlüssel per Link, Hinweis-Prüfung |
| Pferderennen   | 2–20            | einzeln         | **ein Gerät**, Handys optional           | Rennlogik, Animation, Verteilen     |

## Empfohlene Reihenfolge

| #  | Spiel           | Warum jetzt?                                                                                  |
| -- | --------------- | --------------------------------------------------------------------------------------------- |
| 1  | **Imposter**    | Klein, sofort spielbar auf einem Gerät, sehr beliebt. Etappe 1 braucht kein Netzwerk.         |
| 2  | **Prost!**      | Technisch einfach (ein Gerät), Aufwand steckt fast nur in den Karten.                         |
| 3  | **Pferderennen**| Kleine Rennlogik, keine Inhalte nötig, läuft auf einem Gerät. Passt als zweites Trinkspiel.    |
| 4  | **Geheimsache** | Etappe 1 kommt dank Schlüssel-QR ohne Raum aus; Handy-Modus nutzt dann die gemeinsamen Bausteine. |
| 5  | **Schätzfragen**| Gleiches Muster wie 2 Dumme (Laptop + Handys). Die Fragen müssen sorgfältig geprüft werden.    |
| 6  | **Who knows more?** | Das größte Projekt: Buzzer übers Netz, Editor für eigene Wände, mehrere Hundert Fragen.        |

## Gemeinsame Bausteine (Schritt 0 vor dem nächsten Handy-Spiel)

`shared/` hat schon Netzwerk (`net.js`), Sounds & Konfetti (`fx.js`) und `config.js`. Mehrere neue Spiele
brauchen dieselben Teile, die heute in `zwei-dumme/`, `pi-mal-daumen/` bzw. `guess-the-word/` stecken:

| Neu in `shared/`     | Woher                                  | Gebraucht von                         |
| -------------------- | -------------------------------------- | ------------------------------------- |
| `match.js` ✅          | `zwei-dumme/js/match.js` → **erledigt**, liegt jetzt in `shared/` | Imposter (Wort raten), Geheimsache (Hinweis prüfen), Who knows more? (Finale) |
| `deck.js`            | `zwei-dumme/js/deck.js` / `guess-the-word/js/deck.js` | alle (Ziehen ohne Wiederholung über Spiele hinweg) |
| `room.js` ✅          | `StageController` / `ClientController` aus `zwei-dumme/js/controllers.js`: Raum, QR, Ping, Wiederverbinden, `Store`, Spieler-ID. **Erledigt** – Guess the word!, 2 Dumme und Pi mal Daumen nutzen es | Who knows more?, Imposter, Geheimsache, Pferderennen, Prost! (Abstimmungen) |
| `ui.css` / `ui.js`   | Lobby mit Teamwahl, Countdown, Timer-Balken, Punktetafel, **Siegerehrung mit Podest** | alle mit Punkten |
| `drinks.js`          | neu: Trinkregeln-Schalter, Schluck/Strafpunkt-Texte, Einblendung | Prost!, Pferderennen, Geheimsache, später optional in allen |

So schrumpft jedes neue Spiel auf **Regeln (`engine.js`) + Inhalte + Oberfläche**. Guess the word! und 2 Dumme
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
| Who knows more? | Falsche Antwort → 1 Schluck pro 200 Punkte Feldwert      |

Auf der Startseite könnten Trinkspiele (Prost!, Pferderennen, Geheimsache mit Trinkregeln) in einem eigenen Abschnitt
**„🍻 Trinkspiele (ab 18)“** stehen.

## Offene Grundsatzfragen

1. **Namen:** Statt der Marken heißen die Spiele **Guess the word!** (früher Activity), **Who knows more?**
   (statt Jeopardy), **Geheimsache** (statt Codenames) und **Prost!** (statt Piccolo). ✅
2. **Reihenfolge** wie oben vorgeschlagen?
3. **Gemeinsame Bausteine** zuerst auslagern (sauberer, etwas Vorarbeit) oder jedes Spiel erst mal für sich
   bauen und später zusammenführen? *Vorschlag:* auslagern, sobald das erste neue Handy-Spiel ansteht
   (Imposter Etappe 2).
