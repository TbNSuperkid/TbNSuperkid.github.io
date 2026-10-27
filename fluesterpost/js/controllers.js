/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne. Führt die Engine aus, öffnet den Raum, dem die Handys beitreten.
 *  - ClientController: Handy einer Mitspielerin / eines Mitspielers, verbunden mit dem Laptop.
 *
 * Zeichnungen sind groß – sie laufen nie über die Ansicht:
 *  - Handy → Laptop: als Aktion beim „Fertig“ (submit) bzw. als Zwischenstand (draft)
 *  - Laptop → Handy: { t: 'image', ref, ops } genau einmal, wenn ein Handy für seinen Schritt eine Zeichnung braucht
 *    (Engine.imageNeed). Kommt ein Gerät neu dazu, bekommt es sie wieder.
 * Gespeichert werden die Bilder getrennt vom kleinen Spielzustand (eigener Schlüssel, höchstens alle 1,5 s).
 */
(function (root) {
  'use strict';

  const E = root.FpEngine;
  const Room = root.GameRoom.create({
    game: E.GAME,
    net: 'fluesterpost-v1-',
    storage: 'fluesterpost',
    engine: E,
  });
  const { Store, KEYS } = Room;
  const IMG_KEY = Room.key('images');
  const IMG_SAVE_MS = 1500;

  /** Gespeicherte Bilder zu einem Spielstand (nur wenn sie zum selben Spiel gehören) */
  function loadImages(state) {
    const saved = Store.get(IMG_KEY);
    return saved && state && saved.game === state.startedAt && saved.images ? saved.images : {};
  }

  class StageController extends Room.StageController {
    constructor(o, cb) {
      // Beim Fortsetzen: Bilder vor dem Start der Engine zurück in den Spielzustand
      if (o.state && !o.state.images) o.state.images = loadImages(o.state);
      super(o, cb);
    }

    get sent() {
      if (!this._sent) this._sent = new Map(); // connId → ref der zuletzt geschickten Zeichnung
      return this._sent;
    }

    /** Spielzustand ohne Bilder speichern, Bilder getrennt und gebremst */
    save() {
      const s = this.engine.s;
      const state = Object.assign({}, s);
      delete state.images;
      Store.set(KEYS.stage, { state, code: this.code, key: this.key, savedAt: Date.now() });
      if (s.imgRev !== this.savedRev && !this.imgTimer) this.imgTimer = setTimeout(() => this.saveImages(), IMG_SAVE_MS);
    }

    saveImages() {
      clearTimeout(this.imgTimer);
      this.imgTimer = null;
      const s = this.engine.s;
      this.savedRev = s.imgRev;
      if (!s.startedAt) Store.remove(IMG_KEY);
      else Store.set(IMG_KEY, { game: s.startedAt, images: s.images });
    }

    changed() {
      super.changed();
      this.sendImages();
    }

    /** Jedem Handy die Zeichnung schicken, die es für seinen Schritt braucht (nur wenn es sie noch nicht hat) */
    sendImages() {
      if (!this.host) return;
      const live = new Set();
      this.host.each((pid, connId) => {
        live.add(connId);
        const ref = this.engine.imageNeed(pid);
        if (!ref || this.sent.get(connId) === ref) return;
        this.sent.set(connId, ref);
        this.host.send(connId, { t: 'image', ref, ops: this.engine.s.images[ref] || [] });
      });
      for (const connId of [...this.sent.keys()]) if (!live.has(connId)) this.sent.delete(connId);
    }

    /** Zeichnung für die Bühne (Vorführung, Galerie, Bild speichern) */
    image(ref) {
      return (ref && this.engine.s.images[ref]) || null;
    }

    leave(keepSave) {
      if (keepSave) this.saveImages();
      else {
        clearTimeout(this.imgTimer);
        Store.remove(IMG_KEY);
      }
      super.leave(keepSave);
    }
  }

  class ClientController extends Room.ClientLink {
    constructor(o, cb) {
      super(
        o,
        Object.assign({}, cb, {
          onMessage: (data) => {
            if (data.t === 'image' && typeof data.ref === 'string' && Array.isArray(data.ops)) cb.onImage(data.ref, data.ops);
          },
        })
      );
    }
  }

  root.FpControllers = Object.assign({}, Room, { StageController, ClientController, IMG_KEY });
})(window);
