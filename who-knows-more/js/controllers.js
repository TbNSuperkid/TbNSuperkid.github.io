/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne (die Wand). Führt die Engine aus; mit Handys (oder einem
 *                      Quizmaster-Handy) öffnet er einen Raum, dem die Handys beitreten.
 *  - ClientController: Handy – Buzzer eines Teams oder Quizmaster-Ansicht.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  root.WKMControllers = root.GameRoom.create({
    game: 'who-knows-more',
    net: 'wkm-v1-',
    storage: 'wkm',
    engine: root.WKMEngine,
  });
})(window);
