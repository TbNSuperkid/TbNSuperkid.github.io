/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne mit der Farbtafel. Führt die Engine aus und speichert den Spielstand.
 *                      Mit Handys öffnet er einen Raum, dem die Handys beitreten.
 *  - ClientController: Handy einer mitspielenden Person, verbunden mit der Bühne.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.FGControllers = root.GameRoom.create({
    game: root.FGEngine.GAME,
    net: 'farbgefuehl-v1-',
    storage: 'farbgefuehl',
    engine: root.FGEngine,
  });
})(window);
