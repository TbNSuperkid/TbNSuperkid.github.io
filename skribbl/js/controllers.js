/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (gemeinsamer Code in shared/room.js).
 *  - StageController:  Laptop/Bühne. Führt die Engine aus, öffnet den Raum, dem die Handys beitreten.
 *  - ClientController: Handy einer Mitspielerin / eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action), sendStroke(msg) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStroke(msg, at), onStrokes(list, at), onStatus(status, info), onKicked(reason)
 *
 * Striche laufen nicht über die Ansicht (die käme zu langsam und wäre zu groß), sondern als eigene Nachrichten:
 *   Handy der zeichnenden Person → Laptop (prüft: darf die das? richtiger Zug?) → alle anderen Handys.
 *   { t: 'stroke', s: msg, at: Zug }   ein Stück Zeichnung (siehe shared/sketch.js)
 *   { t: 'strokes', all: [...], at }   alles bisher, für Geräte, die (wieder) dazukommen
 * Der Laptop merkt sich die Zeichnungen aller Züge für die Galerie am Spielende.
 */
(function (root) {
  'use strict';

  const E = root.SkEngine;
  const Room = root.GameRoom.create({
    game: E.GAME,
    net: 'skribbl-v1-',
    storage: 'skribbl',
    engine: E,
  });
  const { Store } = Room;
  const DRAW_KEY = Room.key('draw');
  const MAX_OPS = 6000;
  const SAVE_MS = 800;

  class StageController extends Room.StageController {
    /** Zeichnungen: { game: startedAt, at: Zug, ops: [...], gallery: { Zug: [...] } } – beim ersten Zugriff geladen */
    get draw() {
      if (!this._draw) {
        const s = this.engine.s;
        const saved = Store.get(DRAW_KEY);
        this._draw =
          saved && s.startedAt && saved.game === s.startedAt && Array.isArray(saved.ops)
            ? { game: saved.game, at: saved.at, ops: saved.ops, gallery: saved.gallery || {} }
            : { game: s.startedAt, at: null, ops: [], gallery: {} };
      }
      return this._draw;
    }

    /** Neuer Zug: alte Zeichnung in die Galerie, Fläche leeren */
    syncTurn() {
      const s = this.engine.s;
      const d = this.draw;
      if (d.game !== s.startedAt) {
        d.game = s.startedAt;
        d.at = null;
        d.ops = [];
        d.gallery = {};
      }
      const no = s.cur ? s.cur.no : null;
      if (d.at !== no) {
        if (d.at != null && d.ops.length) d.gallery[d.at] = d.ops;
        d.at = no;
        d.ops = [];
        this.saveDrawSoon();
      }
    }

    changed() {
      this.syncTurn();
      super.changed();
    }

    saveDrawSoon() {
      clearTimeout(this.drawTimer);
      this.drawTimer = setTimeout(() => this.saveDraw(), SAVE_MS);
    }

    saveDraw() {
      clearTimeout(this.drawTimer);
      const d = this.draw;
      if (!d.game) Store.remove(DRAW_KEY);
      else Store.set(DRAW_KEY, d);
    }

    /** Zeichnung eines Zuges (für die Galerie) */
    galleryOps(no) {
      const d = this.draw;
      if (d.at === no) return d.ops;
      return d.gallery[no] || null;
    }

    /** Handy ist (wieder) da: bisherige Zeichnung schicken */
    welcomed(pid, connId) {
      const d = this.draw;
      if (this.host && d.at != null && d.ops.length) this.host.send(connId, { t: 'strokes', all: d.ops, at: d.at });
    }

    message(pid, data, connId) {
      if (data && data.t === 'stroke') this.stroke(pid, data.s, data.at, connId);
    }

    /** Strich prüfen, merken und an alle anderen weitergeben */
    stroke(pid, msg, at, fromConn) {
      const e = this.engine;
      this.syncTurn();
      if (!e.canDraw(pid) || at !== e.stepKey()) return false;
      const op = E.cleanOp(msg);
      if (!op) return false;
      const d = this.draw;
      if (op.k === 'clear') d.ops = [];
      else if (d.ops.length >= MAX_OPS && op.k !== 'u') return false;
      d.ops.push(op);
      if (this.host) {
        this.host.each((p, connId) => {
          if (connId !== fromConn) this.host.send(connId, { t: 'stroke', s: op, at });
        });
      }
      if (pid !== E.STAGE && this.cb.onStroke) this.cb.onStroke(op, at);
      this.saveDrawSoon();
      return true;
    }

    /** Am Laptop gezeichnet (Einstellung „Zeichnen am Laptop“) */
    sendStroke(msg) {
      this.stroke(E.STAGE, msg, this.engine.stepKey(), null);
    }

    leave(keepSave) {
      if (keepSave) this.saveDraw();
      else {
        clearTimeout(this.drawTimer);
        Store.remove(DRAW_KEY);
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
            if (data.t === 'stroke') cb.onStroke(data.s, data.at);
            else if (data.t === 'strokes') cb.onStrokes(data.all || [], data.at);
          },
        })
      );
    }

    sendStroke(msg, at) {
      this.send({ t: 'stroke', s: msg, at });
    }
  }

  root.SkControllers = Object.assign({}, Room, { StageController, ClientController, DRAW_KEY });
})(window);
