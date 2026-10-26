/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne. Führt die Engine aus; mit Handy öffnet er einen Raum,
 *                      dem die Handys beitreten.
 *  - ClientController: Handy eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.SEControllers = root.GameRoom.create({
    game: root.SEEngine.GAME,
    net: 'schlechterklaert-v1-',
    storage: 'schlechterklaert',
    engine: root.SEEngine,
  });
})(window);
