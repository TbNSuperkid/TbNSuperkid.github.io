/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Host. Führt die Engine aus. Bei „Ein Gerät“ läuft alles nur hier,
 *                      bei „Jeder ein Handy“ öffnet er einen Raum. Spielt der Host mit, ist er Spieler „stage“.
 *  - ClientController: Handy eines Mitspielers, verbunden mit dem Host.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.IMControllers = root.GameRoom.create({
    game: 'imposter',
    net: 'imposter-v1-',
    storage: 'imposter',
    engine: root.IMEngine,
  });
})(window);
