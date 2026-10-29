/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne und Lautsprecher. Führt die Engine aus; mit Handys öffnet er einen Raum,
 *                      dem die Handys beitreten. Ein Gerät: läuft ohne Raum.
 *  - ClientController: Handy einer Mitspielerin / eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.GTSControllers = root.GameRoom.create({
    game: root.GTSEngine.GAME,
    net: 'guessthesong-v1-',
    storage: 'guessthesong',
    engine: root.GTSEngine,
  });
})(window);
