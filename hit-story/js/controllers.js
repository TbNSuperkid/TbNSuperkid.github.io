/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne. Führt die Engine aus; mit Handys öffnet er einen Raum,
 *                      dem die Handys beitreten. Ein Gerät: läuft ohne Raum.
 *  - ClientController: Handy einer Mitspielerin / eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.HSControllers = root.GameRoom.create({
    game: root.HSEngine.GAME,
    net: 'hitstory-v1-',
    storage: 'hitstory',
    engine: root.HSEngine,
  });
})(window);
