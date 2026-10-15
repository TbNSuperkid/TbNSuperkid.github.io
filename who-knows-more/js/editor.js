/*
 * Editor für eigene Wände (Geburtstage, Insider-Runden, Schulquiz …).
 *  - Liste aller gespeicherten Wände: spielen, bearbeiten, als Link teilen, als Datei exportieren, löschen
 *  - Import: Datei (.json) oder eingefügter Link
 *  - Bearbeiten: Titel, Runde 1 (+ optional Runde 2), 1–6 Kategorien mit je 5 Fragen, Joker-Felder,
 *    Bilder (URL), Finalfrage. Ein Entwurf wird laufend gespeichert, damit beim Neuladen nichts verloren geht.
 *
 * Die Oberfläche (app.js) ruft WKMEditor.create(api) auf und bekommt HTML-Bausteine und Aktionen zurück.
 * api: { ui, render, toast, esc, askConfirm, playWall(id), goHome(), showModal(name, data) }
 */
(function (root) {
  'use strict';

  const Board = root.WKMBoard;
  const Store = root.GameRoom.Store;
  const DRAFT_KEY = 'wkm.editor.draft.v1';
  const { ROWS, MAX_COLS, MAX_ROUNDS, LIMITS } = Board;

  function create(api) {
    const { ui, esc } = api;

    function state() {
      if (!ui.editor) ui.editor = { wall: null, round: 0, dirty: false, imgOpen: {}, linkInput: '' };
      return ui.editor;
    }

    function saveDraft() {
      const ed = state();
      Store.set(DRAFT_KEY, { wall: ed.wall, round: ed.round, dirty: ed.dirty, savedAt: Date.now() });
    }

    function clearDraft() {
      Store.remove(DRAFT_KEY);
    }

    /** Entwurf nach dem Neuladen wiederherstellen */
    function restoreDraft() {
      const d = Store.get(DRAFT_KEY);
      if (!d || !d.wall) return false;
      const w = Board.sanitizeWall(d.wall, true);
      if (!w) return false;
      Object.assign(state(), { wall: w, round: Math.min(d.round || 0, w.rounds.length - 1), dirty: !!d.dirty, imgOpen: {} });
      return true;
    }

    function open(wall) {
      const w = Board.sanitizeWall(wall || Board.emptyWall(), true);
      Object.assign(state(), { wall: w, round: 0, dirty: !wall, imgOpen: {} });
      saveDraft();
      ui.screen = 'editor';
      root.scrollTo(0, 0);
      api.render();
    }

    function save() {
      const ed = state();
      if (!ed.wall.title.trim()) ed.wall.title = 'Meine Wand';
      const saved = Board.saveWall(ed.wall);
      if (!saved) return null;
      ed.wall = saved;
      ed.dirty = false;
      saveDraft();
      return saved;
    }

    function leaveEditor() {
      clearDraft();
      ui.editor = null;
      ui.screen = 'walls';
      api.render();
    }

    function download(wall) {
      const blob = new Blob([Board.exportJson(wall)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download =
        (wall.title || 'wand')
          .toLowerCase()
          .replace(/[^a-z0-9äöüß]+/gi, '-')
          .replace(/^-|-$/g, '') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    }

    async function share(wall) {
      const w = Board.sanitizeWall(wall, false);
      if (!w) {
        api.toast('Die Wand ist noch leer – erst ein paar Fragen eintragen.');
        return;
      }
      const code = await Board.encodeLink(w);
      const link = root.location.origin + root.location.pathname + '#wand=' + code;
      api.showModal('share', { link, title: w.title });
    }

    function importFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const w = Board.importJson(reader.result);
        if (!w) {
          api.toast('Diese Datei ist keine Wand von „Who knows more?“.');
          return;
        }
        Board.saveWall(w);
        api.toast(`„${w.title || 'Wand'}“ importiert.`);
      };
      reader.onerror = () => api.toast('Die Datei konnte nicht gelesen werden.');
      reader.readAsText(file);
    }

    async function importLink(text) {
      const m = String(text || '').match(/#wand=([A-Za-z0-9_-]+)/) || String(text || '').match(/^\s*([zj][A-Za-z0-9_-]{8,})\s*$/);
      const w = m ? await Board.decodeLink(m[1]) : null;
      if (!w) {
        api.toast('Das ist kein gültiger Wand-Link.');
        return;
      }
      state().linkInput = '';
      api.showModal('import-wall', { wall: w });
    }

    /* ---------- Bausteine ---------- */

    function statsText(w) {
      const st = Board.wallStats(w);
      const parts = [`${st.rounds} ${st.rounds === 1 ? 'Runde' : 'Runden'}`, `${st.cats} ${st.cats === 1 ? 'Kategorie' : 'Kategorien'}`, `${st.questions} Fragen`];
      if (st.final) parts.push('mit Finalfrage');
      return parts.join(' · ');
    }

    /* ---------- Liste ---------- */

    function listHtml() {
      const walls = Board.listWalls();
      const cards = walls
        .map(
          (w) => `
        <article class="wall-card">
          <div class="wall-card-body">
            <b>${esc(w.title || 'Ohne Titel')}</b>
            <small>${esc(statsText(w))}</small>
            <small class="muted">${esc(new Date(w.updatedAt).toLocaleDateString('de-DE'))}</small>
          </div>
          <div class="wall-card-actions">
            <button class="btn btn-primary btn-small" data-act="wall-play" data-id="${esc(w.id)}" ${Board.sanitizeWall(w) ? '' : 'disabled'}>▶ Spielen</button>
            <button class="btn btn-ghost btn-small" data-act="wall-edit" data-id="${esc(w.id)}">✏️ Bearbeiten</button>
            <button class="icon-btn" data-act="wall-share" data-id="${esc(w.id)}" title="Als Link teilen" aria-label="Als Link teilen">🔗</button>
            <button class="icon-btn" data-act="wall-download" data-id="${esc(w.id)}" title="Als Datei speichern" aria-label="Als Datei speichern">⬇️</button>
            <button class="icon-btn" data-act="wall-delete" data-id="${esc(w.id)}" title="Löschen" aria-label="Löschen">🗑️</button>
          </div>
        </article>`
        )
        .join('');
      return `
      <div class="screen walls">
        <header class="screen-head">
          <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
          <h1>Eigene Wände</h1>
          <span></span>
        </header>
        <p class="hint center">Für Geburtstage, Insider-Runden oder das Schulquiz: Kategorien benennen, Fragen eintragen, losspielen.
          Gespeichert wird im Browser – zum Mitnehmen als Datei oder Link.</p>
        <div class="walls-actions">
          <button class="btn btn-primary" data-act="wall-new">＋ Neue Wand</button>
          <label class="btn btn-ghost file-btn">📂 Datei importieren<input type="file" accept=".json,application/json" data-field="wall-file" hidden /></label>
        </div>
        <form class="link-import" data-form="wall-link">
          <input class="input" type="text" placeholder="Wand-Link einfügen …" value="${esc(state().linkInput)}" data-field="wall-link" autocomplete="off" spellcheck="false" />
          <button class="btn btn-ghost" type="submit">Übernehmen</button>
        </form>
        ${cards ? `<div class="wall-list">${cards}</div>` : `<div class="empty-note">🧩<b>Noch keine eigene Wand</b><small>Tippe auf „Neue Wand“ und leg los.</small></div>`}
      </div>`;
    }

    /* ---------- Bearbeiten ---------- */

    function catHtml(k, ci, r) {
      const ed = state();
      const rows = k.cells
        .map((c, ri) => {
          const imgKey = `${r}-${ci}-${ri}`;
          const imgOpen = ed.imgOpen[imgKey] || !!c.img;
          return `
          <div class="ed-cell ${c.joker ? 'is-joker' : ''}">
            <div class="ed-cell-head">
              <span class="ed-value">${Board.cellValue(ri, r)}</span>
              ${ri > 0 ? `<button class="chip-toggle ${c.joker ? 'on' : ''}" data-act="ed-joker" data-c="${ci}" data-r="${ri}" aria-pressed="${c.joker}" title="Joker-Feld">🎲 Joker</button>` : ''}
              <button class="chip-toggle ${imgOpen ? 'on' : ''}" data-act="ed-img" data-c="${ci}" data-r="${ri}" title="Bild zur Frage">🖼️ Bild</button>
            </div>
            <textarea class="input ed-q" rows="2" maxlength="${LIMITS.q}" placeholder="Frage" data-field="ed-q" data-c="${ci}" data-r="${ri}">${esc(c.q)}</textarea>
            <input class="input ed-a" type="text" maxlength="${LIMITS.a}" placeholder="Antwort" value="${esc(c.a)}" data-field="ed-a" data-c="${ci}" data-r="${ri}" autocomplete="off" />
            ${imgOpen ? `<input class="input ed-img" type="url" maxlength="${LIMITS.img}" placeholder="Bild-Adresse (https://…)" value="${esc(c.img)}" data-field="ed-img" data-c="${ci}" data-r="${ri}" autocomplete="off" />` : ''}
          </div>`;
        })
        .join('');
      return `
        <section class="ed-cat">
          <div class="ed-cat-head">
            <input class="input input-team" type="text" maxlength="${LIMITS.cat}" placeholder="Kategorie ${ci + 1}" value="${esc(k.name)}" data-field="ed-cat" data-c="${ci}" autocomplete="off" />
            <button class="icon-btn" data-act="ed-del-cat" data-c="${ci}" title="Kategorie löschen" aria-label="Kategorie löschen">✕</button>
          </div>
          ${rows}
        </section>`;
    }

    function editHtml() {
      const ed = state();
      const w = ed.wall;
      const r = ed.round;
      const round = w.rounds[r];
      const tabs = w.rounds
        .map((_, i) => `<button class="seg-btn ${i === r ? 'on' : ''}" data-act="ed-round" data-r="${i}" aria-pressed="${i === r}">Runde ${i + 1} <small>(${Board.cellValue(0, i)}–${Board.cellValue(ROWS - 1, i)})</small></button>`)
        .join('');
      return `
      <div class="screen editor">
        <header class="screen-head">
          <button class="btn btn-ghost btn-small" data-act="ed-back">← Wände</button>
          <h1>Wand bearbeiten</h1>
          <button class="btn btn-small btn-primary" data-act="ed-save">💾 Speichern</button>
        </header>
        <section class="panel">
          <label class="label" for="ed-title">Titel</label>
          <input id="ed-title" class="input input-big" type="text" maxlength="${LIMITS.title}" placeholder="z. B. Annas 30. Geburtstag" value="${esc(w.title)}" data-field="ed-title" autocomplete="off" />
          <p class="muted small">Leere Felder bleiben im Spiel frei. Joker-Felder ohne Markierung werden zufällig verteilt.
            Beim Spielen mit „Gemischt“ füllt der Katalog fehlende Kategorien und Runden auf.</p>
        </section>
        <div class="ed-tabs">
          <div class="seg" role="group">${tabs}</div>
          ${w.rounds.length < MAX_ROUNDS ? '<button class="btn btn-ghost btn-small" data-act="ed-add-round">＋ Runde 2</button>' : `<button class="btn btn-link" data-act="ed-del-round">Runde ${r + 1} löschen</button>`}
        </div>
        <div class="ed-grid">
          ${round.cats.map((k, ci) => catHtml(k, ci, r)).join('')}
          ${round.cats.length < MAX_COLS ? `<button class="ed-add-cat" data-act="ed-add-cat">＋ Kategorie<small>${round.cats.length} von ${MAX_COLS}</small></button>` : ''}
        </div>
        <section class="panel ed-final">
          <h2>🏁 Finalfrage <small class="muted">(optional – sonst aus dem Katalog)</small></h2>
          <input class="input" type="text" maxlength="${LIMITS.cat}" placeholder="Kategorie" value="${esc(w.final.cat)}" data-field="ed-fcat" autocomplete="off" />
          <textarea class="input" rows="2" maxlength="${LIMITS.q}" placeholder="Frage" data-field="ed-fq">${esc(w.final.q)}</textarea>
          <input class="input" type="text" maxlength="${LIMITS.a}" placeholder="Antwort" value="${esc(w.final.a)}" data-field="ed-fa" autocomplete="off" />
        </section>
        <div class="sticky-start sticky-row">
          <span class="muted small">${ed.dirty ? '● Nicht gespeichert' : '✓ Gespeichert'} · ${esc(statsText(w))}</span>
          <button class="btn btn-ghost" data-act="ed-save">💾 Speichern</button>
          <button class="btn btn-primary" data-act="ed-play">▶ Speichern & spielen</button>
        </div>
      </div>`;
    }

    /* ---------- Aktionen ---------- */

    function touch() {
      state().dirty = true;
      saveDraft();
    }

    const actions = {
      walls: () => {
        ui.screen = 'walls';
        ui.error = null;
        root.scrollTo(0, 0);
        api.render();
      },
      'wall-new': () => open(null),
      'wall-edit': (el) => {
        const w = Board.getWall(el.dataset.id);
        if (w) open(w);
      },
      'wall-play': (el) => api.playWall(el.dataset.id),
      'wall-share': (el) => {
        const w = Board.getWall(el.dataset.id);
        if (w) share(w);
      },
      'wall-download': (el) => {
        const w = Board.getWall(el.dataset.id);
        if (w) download(w);
      },
      'wall-delete': (el) => {
        const w = Board.getWall(el.dataset.id);
        if (!w) return;
        api.askConfirm({
          title: 'Wand löschen?',
          text: `„${w.title || 'Ohne Titel'}“ wird aus diesem Browser gelöscht. Exportierte Dateien und Links funktionieren weiter.`,
          yes: 'Löschen',
          danger: true,
          run: () => {
            Board.deleteWall(w.id);
            if (ui.setup && ui.setup.settings.wallId === w.id) ui.setup.settings.wallId = null;
            api.render();
          },
        });
      },
      'wall-import-save': () => {
        const w = ui.modalData && ui.modalData.wall;
        if (!w) return;
        Board.saveWall(w);
        ui.modal = null;
        ui.modalData = null;
        ui.screen = 'walls';
        api.toast(`„${w.title || 'Wand'}“ gespeichert.`);
      },
      'copy-link': async () => {
        const link = ui.modalData && ui.modalData.link;
        try {
          await navigator.clipboard.writeText(link);
          api.toast('Link kopiert ✓');
        } catch {
          const input = document.querySelector('[data-field="share-link"]');
          if (input) {
            input.select();
            api.toast('Link markiert – jetzt kopieren (Strg+C).');
          }
        }
      },
      'ed-back': () => {
        if (!state().dirty) {
          leaveEditor();
          return;
        }
        api.askConfirm({
          title: 'Ungespeicherte Änderungen',
          text: 'Willst du die Wand vorher speichern?',
          yes: 'Speichern',
          no: 'Verwerfen',
          run: () => {
            save();
            leaveEditor();
          },
          runNo: () => leaveEditor(),
        });
      },
      'ed-save': () => {
        if (save()) api.toast('Wand gespeichert ✓');
        api.render();
      },
      'ed-play': () => {
        const saved = save();
        if (!saved) return;
        if (!Board.sanitizeWall(saved)) {
          api.toast('Trag zuerst mindestens eine Kategorie mit Fragen ein.');
          api.render();
          return;
        }
        clearDraft();
        ui.editor = null;
        api.playWall(saved.id);
      },
      'ed-round': (el) => {
        state().round = +el.dataset.r;
        saveDraft();
        api.render();
      },
      'ed-add-round': () => {
        const ed = state();
        if (ed.wall.rounds.length >= MAX_ROUNDS) return;
        ed.wall.rounds.push({ cats: [Board.emptyCat(), Board.emptyCat(), Board.emptyCat(), Board.emptyCat()] });
        ed.round = ed.wall.rounds.length - 1;
        touch();
        api.render();
      },
      'ed-del-round': () => {
        const ed = state();
        if (ed.wall.rounds.length <= 1) return;
        api.askConfirm({
          title: `Runde ${ed.round + 1} löschen?`,
          text: 'Alle Kategorien und Fragen dieser Runde werden entfernt.',
          yes: 'Löschen',
          danger: true,
          run: () => {
            ed.wall.rounds.splice(ed.round, 1);
            ed.round = 0;
            touch();
            api.render();
          },
        });
      },
      'ed-add-cat': () => {
        const ed = state();
        const cats = ed.wall.rounds[ed.round].cats;
        if (cats.length >= MAX_COLS) return;
        cats.push(Board.emptyCat());
        touch();
        api.render();
      },
      'ed-del-cat': (el) => {
        const ed = state();
        const cats = ed.wall.rounds[ed.round].cats;
        const k = cats[+el.dataset.c];
        if (!k) return;
        const remove = () => {
          cats.splice(+el.dataset.c, 1);
          if (!cats.length) cats.push(Board.emptyCat());
          ed.imgOpen = {};
          touch();
          api.render();
        };
        if (!k.name && !k.cells.some((c) => c.q || c.a)) remove();
        else api.askConfirm({ title: 'Kategorie löschen?', text: `„${k.name || 'Ohne Namen'}“ mit allen Fragen wird entfernt.`, yes: 'Löschen', danger: true, run: remove });
      },
      'ed-joker': (el) => {
        const ed = state();
        const c = ed.wall.rounds[ed.round].cats[+el.dataset.c].cells[+el.dataset.r];
        c.joker = !c.joker;
        touch();
        api.render();
      },
      'ed-img': (el) => {
        const ed = state();
        const key = `${ed.round}-${el.dataset.c}-${el.dataset.r}`;
        const c = ed.wall.rounds[ed.round].cats[+el.dataset.c].cells[+el.dataset.r];
        if (ed.imgOpen[key] || c.img) {
          ed.imgOpen[key] = false;
          if (c.img) {
            c.img = '';
            touch();
          }
        } else {
          ed.imgOpen[key] = true;
          ui.focus = `[data-field="ed-img"][data-c="${el.dataset.c}"][data-r="${el.dataset.r}"]`;
        }
        api.render();
      },
    };

    /** Eingaben im Editor – ohne Neuzeichnen, damit der Cursor bleibt */
    function onInput(el) {
      const f = el.dataset && el.dataset.field;
      if (!f) return false;
      if (f === 'wall-link') {
        state().linkInput = el.value;
        return true;
      }
      if (!f.startsWith('ed-') || !state().wall) return false;
      const ed = state();
      const w = ed.wall;
      const cell = () => w.rounds[ed.round].cats[+el.dataset.c].cells[+el.dataset.r];
      if (f === 'ed-title') w.title = el.value;
      else if (f === 'ed-cat') w.rounds[ed.round].cats[+el.dataset.c].name = el.value;
      else if (f === 'ed-q') cell().q = el.value;
      else if (f === 'ed-a') cell().a = el.value;
      else if (f === 'ed-img') cell().img = el.value.trim();
      else if (f === 'ed-fcat') w.final.cat = el.value;
      else if (f === 'ed-fq') w.final.q = el.value;
      else if (f === 'ed-fa') w.final.a = el.value;
      else return false;
      touch();
      api.render(); // Statuszeile aktualisieren – das Feld mit dem Cursor lässt morphdom in Ruhe
      return true;
    }

    function onChange(el) {
      if (el.dataset && el.dataset.field === 'wall-file') {
        importFile(el.files && el.files[0]);
        el.value = '';
        return true;
      }
      return false;
    }

    function onSubmit(form) {
      if (form.dataset.form !== 'wall-link') return false;
      importLink(form.querySelector('[data-field="wall-link"]').value);
      return true;
    }

    /** Link mit #wand=… geöffnet? */
    async function checkHash() {
      const m = root.location.hash.match(/^#wand=([A-Za-z0-9_-]+)/);
      if (!m) return false;
      root.history.replaceState(null, '', root.location.pathname + root.location.search);
      const w = await Board.decodeLink(m[1]);
      if (!w) {
        api.toast('Der Wand-Link ist leider kaputt.');
        return false;
      }
      api.showModal('import-wall', { wall: w });
      return true;
    }

    return { listHtml, editHtml, actions, onInput, onChange, onSubmit, restoreDraft, checkHash, statsText, open };
  }

  root.WKMEditor = { create };
})(window);
