/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne. Führt die Engine aus; bei „Alle mit Handy“ öffnet er einen Raum.
 *                      Bei „Nur Chef-Handys“ läuft alles auf dem Laptop – die Schlüsselkarte kommt
 *                      per QR-Link aufs Handy und klappt ohne Verbindung. Mit Internet öffnet der Laptop
 *                      nebenbei einen Raum, über den die Schlüsselkarte „Hinweis gegeben“ meldet.
 *  - ClientController: Handy eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.GSControllers = root.GameRoom.create({
    game: 'geheimsache',
    net: 'geheimsache-v1-',
    storage: 'geheimsache',
    engine: root.GSEngine,
  });
})(window);
