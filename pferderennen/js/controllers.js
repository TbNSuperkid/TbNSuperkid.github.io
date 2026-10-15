/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Gerät mit der Rennbahn. Führt die Engine aus und speichert den Spielstand.
 *                      Bei „Ein Gerät“ läuft alles nur hier (Handys kommen in Etappe 3 dazu).
 *  - ClientController: Handy, verbunden mit der Rennbahn (Etappe 3).
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.PFControllers = root.GameRoom.create({
    game: 'pferderennen',
    net: 'pferderennen-v1-',
    storage: 'pferderennen',
    engine: root.PFEngine,
  });
})(window);
