# 🎵 Musikspiele – gemeinsame Grundlagen

Vier Ideen drehen sich um Musik: **Jahr raten** (Hitster), **Guess the song**, **Finish the lyrics** und
**Übersetzte Lyrics**. Sie haben dieselben zwei Probleme – **woher kommt der Ton?** und **dürfen wir Songtexte
zeigen?** – und können sich eine **Song-Datenbank** teilen. Darum steht das hier einmal für alle.

| Plan                                                 | Braucht Audio? | Braucht Songtexte? |
| ---------------------------------------------------- | -------------- | ------------------ |
| [jahr-raten.md](jahr-raten.md)                       | ja             | nein               |
| [guess-the-song.md](guess-the-song.md)               | ja (oder Summen) | nein             |
| [finish-the-lyrics.md](finish-the-lyrics.md)         | optional       | ja ⚠️               |
| [uebersetzte-lyrics.md](uebersetzte-lyrics.md)       | nein           | ja ⚠️ (oder Titel)  |

---

## 1. Woher kommt der Ton?

Wir können **keine MP3s ins Repo** legen – die Seite ist öffentlich auf GitHub Pages, das wäre Weiterverbreitung
geschützter Aufnahmen. Möglichkeiten:

| Quelle                          | Wie                                                                    | Vorteile                         | Haken                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| 🍏 **iTunes Search API**         | `itunes.apple.com/search?term=…&entity=song` liefert `previewUrl` (30-s-Ausschnitt, `.m4a`) | kostenlos, kein Login, kein Schlüssel, deutscher Katalog (`country=de`) | Ausschnitte sind laut Apple **zur Werbung neben einem Store-Link** gedacht → Bedingungen lesen, Link „In Apple Music öffnen“ immer anzeigen. Nur 30 s, oft der Refrain |
| 🎧 **Deezer API**                | `api.deezer.com/search?q=…` liefert `preview` (30 s, MP3)               | kostenlos, kein Login            | keine CORS-Header (nur JSONP), Bedingungen ebenfalls prüfen            |
| 🟢 **Spotify**                   | Web API / Web Playback SDK                                             | jeder hat es                     | **Spotify-Entwicklerrichtlinie verbietet ausdrücklich Spiele inkl. Quiz.** Ausschnitt-URLs gibt es für neue Apps nicht mehr. → **nicht nutzen** |
| ▶️ **YouTube-Einbettung**        | IFrame-Player mit Startzeit                                            | fast jeder Song da               | Player darf laut Bedingungen nicht einfach versteckt werden, Werbung, Titel steht im Player → für Raten ungeeignet |
| 🔊 **„Selbst abspielen“**        | App zeigt nur *„Song 7“* + QR/Link, eine Person spielt ihn auf ihrem eigenen Spotify/Lautsprecher ab | rechtlich sauber, volle Songs, beste Qualität | eine Person kennt die Lösung (oder spielt „blind“ über eine Playlist im Zufallsmodus) |
| 🎤 **Summen / Singen**           | Eine Person bekommt den Titel aufs Handy und summt                     | kein Audio, kein Rechteproblem, sehr lustig | nur für Guess the song |

**Vorschlag:** Standard ist **iTunes-Ausschnitte** mit deutlichem Store-Link (Bedingungen vorher genau lesen und
in den Entscheidungen festhalten), Ausweichweg **„Selbst abspielen“**. Beides über eine Schnittstelle:

```js
// shared/audio-source.js
AudioSource.itunes   // .find(song) → { url, start: 0, length: 30, storeUrl }
AudioSource.manual   // .find(song) → { manual: true } – Bühne zeigt „▶️ Jetzt Song 7 abspielen“
```

- Die **Song-Datenbank speichert keine Links**, nur Titel/Interpret/Jahr. Die Ausschnitt-URL wird **beim Spielen**
  über die Suche geholt (`term = Interpret + Titel`, Treffer mit passender Dauer/Interpret nehmen) und im Browser
  zwischengespeichert. Fällt ein Song weg, wird er übersprungen.
- **Abgespielt wird nur auf dem Laptop** (Bühne = Lautsprecher). Handys bekommen nie die URL, sonst steht der Titel
  im Entwickler-Werkzeug.
- **Autoplay-Sperre:** Browser spielen Ton erst nach einem Klick. Die Bühne braucht deshalb einmal *„🔊 Ton an“*
  vor dem Start (wie bei `shared/fx.js`).
- Ausschnitt-Länge und -Start bestimmt das Spiel (Guess the song: 1 s, 2 s, 4 s …; Jahr raten: ganze 30 s).

---

## 2. Dürfen wir Songtexte zeigen? ⚠️

**Songtexte sind urheberrechtlich geschützt** – auch kurze Zeilen, und **Übersetzungen** davon sind
Bearbeitungen und damit ebenfalls geschützt. Lyrics-Seiten zahlen dafür Lizenzen. Eine öffentliche Seite mit
hunderten Textzeilen ist deshalb nicht drin. Wege, die ohne veröffentlichte Texte auskommen:

| Weg                                  | Für                          | Wie                                                                  |
| ------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| 🎤 **Spielleitung singt/sagt an**     | Finish the lyrics            | App zeigt der Spielleitung nur *Titel + „ab dem Refrain“*, sie singt an, die Runde entscheidet |
| 🔊 **Audio bricht ab**                | Finish the lyrics            | iTunes-Ausschnitt läuft und stoppt, alle singen/tippen weiter, Lösung = Weiterlaufen lassen |
| 📦 **Eigene Pakete, nur lokal**       | Finish the lyrics, Übersetzte Lyrics | Editor wie bei Who knows more? – Texte werden **im eigenen Browser** gespeichert und als Datei geteilt, **nicht im Repo** |
| 🌍 **Übersetzte Titel**               | Übersetzte Lyrics            | Nur Songtitel werden übersetzt (*„Böse Romanze“* → *Bad Romance*), Titel sind kurz und als Bezeichnung unproblematischer |
| 📝 **Eigene Inhaltsangaben**          | Übersetzte Lyrics            | Wie Schlecht erklärt: *„Eine Frau erklärt ihrem Ex, dass sie ohne ihn klarkommt“* → eigene Texte |

**Vorschlag:** Im Repo stehen **nur Titel, Interpreten, Jahre, eigene Beschreibungen und eigene Titel-Übersetzungen**.
Echte Textzeilen nur über **eigene, lokale Pakete**. Das ist keine Rechtsberatung – im Zweifel vorher nachfragen.

---

## 3. Gemeinsame Song-Datenbank

Ein Format für alle vier Spiele, Textzeilen wie bei Pi mal Daumen / Schlecht erklärt:

```
Titel | Interpret | Jahr | Stufe | weitere Antworten (; getrennt) | Titel-Übersetzung | Beschreibung
```

```js
window.SONGS = window.SONGS || {};
window.SONGS.pop2000 = `
Bad Romance | Lady Gaga | 2009 | 1 | | Böse Romanze | Eine Frau verliebt sich ausgerechnet in den Falschen und findet das auch noch gut.
Atemlos durch die Nacht | Helene Fischer | 2013 | 1 | Atemlos | Breathless Through The Night |
`;
```

- **Jahr** = Erstveröffentlichung der Single (nicht Remaster/Best-of) – das ist der fehleranfälligste Wert,
  jedes Jahr einzeln prüfen
- **Stufe 1–3** wie bei Schlecht erklärt (1 = kennt jede/r)
- **Kategorien** als Dateien: `charts-80er.js`, `charts-90er.js`, `charts-2000er.js`, `charts-2010er.js`,
  `charts-2020er.js`, `deutsch.js`, `schlager-party.js`, `rock.js`, `hiphop.js`, `film-serie.js`, `klassiker-vor-1980.js`
- **Ziel: 600 Songs**, gleichmäßig über die Jahrzehnte (wichtig für Jahr raten)
- Ablage: `shared/songs/` (wird von allen Musikspielen geladen) und `shared/songs.js` zum Einlesen/Filtern

### Titel-Erkennung

✅ Erledigt mit Hit Story: `schlecht-erklaert/js/titles.js` liegt jetzt in **`shared/titles.js`** (`GameTitles.checkSong`) und ist um
**Interpret** erweitert (*„Gaga“* zählt als Lady Gaga, *„feat. …“* wird ignoriert, Klammerzusätze wie
*„(Radio Edit)“* fliegen raus).

---

## 4. Ein Spiel oder vier?

| Variante                        | Vorteile                                               | Nachteile                      |
| ------------------------------- | ------------------------------------------------------ | ------------------------------ |
| **Vier eigene Spiele**           | klare Karten auf der Startseite, jedes für sich einfach | viel doppelte Oberfläche       |
| **Ein Spiel „Musikabend“ mit 4 Modi** | eine Lobby, ein Audio-Aufbau, Modi im Wechsel spielbar | großer Ordner, Startseite zeigt nur eine Karte |

**Vorschlag:** Ein Ordner `musikabend/` mit **4 Modi**, aber die Pläne bleiben getrennt, damit jeder Modus für sich
gebaut werden kann. Reihenfolge: **Guess the song** (mit Summen-Modus sofort ohne Audio spielbar) →
**Jahr raten** → **Übersetzte Lyrics** (Titel-Modus) → **Finish the lyrics**.

## 5. Offene Entscheidungen

1. ~~Ein Spiel „Musikabend“ oder vier Ordner?~~ → **eigene Ordner** (`hit-story/`, `guess-the-song/`), gemeinsam sind
   `shared/songs/`, `shared/songs.js`, `shared/titles.js` und `shared/audio-source.js`.
2. ~~iTunes-Ausschnitte oder nur „Selbst abspielen“?~~ → **beides** (Hit Story): iTunes-Ausschnitte als Standard, immer mit
   „In Apple Music öffnen“ neben dem Song, „Selbst abspielen“ als Ausweichweg. `shared/audio-source.js` ist fertig.
3. ~~Eigene Lyrics-Pakete lokal: ja/nein?~~ → **nein** (Finish the lyrics kommt mit Audio stoppt + Ansingen aus).
