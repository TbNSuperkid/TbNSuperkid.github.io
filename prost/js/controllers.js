/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Kartengerät. Führt die Engine aus. Bei „Ein Gerät“ läuft alles nur hier,
 *                      bei „Mit Handys“ öffnet er einen Raum für die Abstimmungen.
 *  - ClientController: Handy, verbunden mit dem Kartengerät (Abstimmungen, Karte mitlesen).
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.PRControllers = root.GameRoom.create({
    game: 'prost',
    net: 'prost-v1-',
    storage: 'prost',
    engine: root.PREngine,
  });
})(window);
