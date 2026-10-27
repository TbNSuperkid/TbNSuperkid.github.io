# Regeln für dieses Projekt

## Tests immer stumm

Alle Tests laufen **ohne Ton** – niemand soll beim Testen Sounds, Fanfaren oder Ticken hören.

- **Browser-Tests** (headless Chrome/Edge, Playwright o. ä.): Browser immer mit `--mute-audio` starten und
  **nicht** mit `--autoplay-policy=no-user-gesture-required`.
- Zusätzlich vor dem ersten Laden im Testprofil den gemeinsamen Stumm-Schalter setzen:
  `localStorage.setItem('games.muted', '1')` (wird von `shared/fx.js` für alle Spiele gelesen).
  Nur in einem eigenen Test-Profil – nie im normalen Browserprofil, sonst sind die Spiele dort auch stumm.
- `npm test` (Node, ohne Browser) erzeugt keinen Ton; neue Tests dürfen das nicht ändern.
